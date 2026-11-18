import { Database } from "bun:sqlite";
import { assess, frontier, type Assessed } from "./evidence.ts";
import { canonical, contractId, isDigest, requireText, validateResources,
  type Contract, type Receipt, type Request, type Role } from "./model.ts";

interface Entry {
  request: string;
  receipt: string | null;
}

interface Checkpoint {
  id: string;
  role: Role;
  candidate: string;
  method: string;
}

export class Ledger {
  readonly contract: Contract;
  readonly id: string;
  private readonly db: Database;

  constructor(path: string, config?: Contract) {
    if (config) contractId(config);
    this.db = new Database(path, { create: config !== undefined, strict: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 5000");
      if (config) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS study (key INTEGER PRIMARY KEY CHECK (key = 1), contract TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS experiment (id TEXT PRIMARY KEY, request TEXT NOT NULL, receipt TEXT);
          CREATE TABLE IF NOT EXISTS checkpoint (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        `);
        this.db.query("INSERT OR IGNORE INTO study VALUES (1, ?)").run(canonical(config));
      }
      const row = this.db.query<{ contract: string }, []>("SELECT contract FROM study WHERE key = 1").get();
      if (!row) throw new Error("Study contract missing");
      this.contract = JSON.parse(row.contract) as Contract;
      this.id = contractId(this.contract);
      if (config && this.id !== contractId(config)) {
        throw new Error("Study already pins a different contract");
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private entries(): Entry[] {
    return this.db.query<Entry, []>("SELECT request, receipt FROM experiment ORDER BY rowid").all();
  }

  private usage(entries: readonly Entry[]) {
    return Object.fromEntries(this.contract.budget.map(resource => {
      let spent = 0;
      let pending = 0;
      for (const entry of entries) {
        if (entry.receipt === null) {
          pending += (JSON.parse(entry.request) as Request).allowance[resource.id];
        } else {
          spent += (JSON.parse(entry.receipt) as Receipt).spent[resource.id];
        }
      }
      return [resource.id, { spent, pending, remaining: Math.max(0, resource.limit - spent - pending) }];
    }));
  }

  hasRequest(id: string): boolean {
    return this.db.query("SELECT 1 FROM experiment WHERE id = ?").get(id) !== null;
  }

  budget() {
    return this.usage(this.entries());
  }

  pending(role: Role) {
    return this.entries().filter(entry => entry.receipt === null)
      .map(entry => JSON.parse(entry.request) as Request).filter(request => request.role === role);
  }

  rows(role: Role): Assessed[] {
    return this.entries().flatMap(entry => {
      const request = JSON.parse(entry.request) as Request;
      if (request.role !== role || entry.receipt === null) return [];
      const receipt = JSON.parse(entry.receipt) as Receipt;
      return [{ request, receipt, decision: assess(this.contract, request, receipt) }];
    });
  }

  freeze(id: string, candidate: string, method: string): void {
    this.db.transaction(() => {
      requireText(id, "freeze ID");
      if (!this.contract.authority.confirmation) throw new Error("Confirmation is outside study authority");
      const checkpoint: Checkpoint = { id, candidate, method, role: "confirmation" };
      const text = canonical(checkpoint);
      const existing = this.db.query<{ data: string }, [string]>("SELECT data FROM checkpoint WHERE id = ?").get(id);
      if (existing) {
        if (existing.data !== text) throw new Error("Freeze ID already pins another candidate or method");
        return;
      }
      if (!frontier(this.contract, this.rows("development"), "development")
        .some(row => row.request.candidate === candidate && row.request.method === method)) {
        throw new Error("Freeze an eligible development frontier candidate under its exact method");
      }
      this.db.query("INSERT INTO checkpoint VALUES (?, ?)").run(id, text);
    }).immediate();
  }

  reserve(request: Request): void {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries({
        id: request.id, question: request.question, prediction: request.prediction, falsifier: request.falsifier,
      })) requireText(value, key);
      if (request.contract !== this.id || !isDigest(request.candidate) || !isDigest(request.method) ||
          (request.parent !== undefined && !isDigest(request.parent))) {
        throw new Error("Request must bind the pinned contract, artifact and method");
      }
      if (request.role !== "development" && request.role !== "confirmation") throw new Error("Invalid evidence role");
      validateResources(this.contract.budget, request.allowance);
      const data = canonical(request);
      const entries = this.entries();
      const existing = entries.find(entry => (JSON.parse(entry.request) as Request).id === request.id);
      if (existing) {
        if (existing.request !== data) throw new Error("Request ID already binds other work");
        return;
      }
      if (request.role === "confirmation") {
        const checkpoint = request.freeze && this.db.query<{ data: string }, [string]>(
          "SELECT data FROM checkpoint WHERE id = ?").get(request.freeze);
        const frozen = checkpoint && JSON.parse(checkpoint.data) as Checkpoint;
        if (!this.contract.authority.confirmation || !frozen ||
            frozen.candidate !== request.candidate || frozen.method !== request.method) {
          throw new Error("Confirmation requires a frozen development candidate and exact method");
        }
      } else if (request.freeze !== undefined) {
        throw new Error("Freeze ID applies to confirmation evidence");
      }
      const accounting = this.usage(entries);
      if (this.contract.budget.some(resource => {
        const usage = accounting[resource.id];
        return usage.spent + usage.pending > resource.limit ||
          request.allowance[resource.id] > usage.remaining;
      })) throw new Error("Cumulative experiment budget exhausted");
      // A reservation is durable before an external worker is started.
      this.db.query("INSERT INTO experiment VALUES (?, ?, NULL)").run(request.id, data);
    }).immediate();
  }

  record(receipt: Receipt): void {
    this.db.transaction(() => {
      const entry = this.db.query<Entry, [string]>(
        "SELECT request, receipt FROM experiment WHERE id = ?").get(receipt.request);
      if (!entry) throw new Error("Reserve the request before recording evidence");
      const request = JSON.parse(entry.request) as Request;
      if (receipt.contract !== request.contract || receipt.candidate !== request.candidate ||
          receipt.method !== request.method || receipt.role !== request.role) {
        throw new Error("Receipt does not bind the reserved experiment");
      }
      if (!["completed", "failed", "interrupted"].includes(receipt.status)) throw new Error("Invalid receipt status");
      if (!receipt.measurements || !receipt.predicates || !receipt.inputs) throw new Error("Malformed evidence");
      validateResources(this.contract.budget, receipt.spent);
      const data = canonical(receipt);
      if (entry.receipt !== null) {
        if (entry.receipt !== data) throw new Error("Terminal receipt already exists");
        return;
      }
      // Persist actual spend even when a worker exceeded its reservation.
      this.db.query("UPDATE experiment SET receipt = ? WHERE id = ?").run(data, request.id);
    }).immediate();
  }

  summary(role: Role) {
    const rows = this.rows(role);
    const baseline = rows.find(row => row.request.candidate === this.contract.search.baseline);
    const pareto = frontier(this.contract, rows, role).map(row => ({
      id: row.request.id, candidate: row.request.candidate, method: row.request.method,
      objectives: row.decision.objectives, evidence: row.receipt.evidence,
    }));
    return {
      contract: this.id, name: this.contract.name, role, sandbox: this.contract.authority.sandbox,
      evaluated: rows.length, eligible: rows.filter(row => row.decision.eligible).length,
      gates: Object.fromEntries(["pass", "fail", "unknown"].map(status => [
        status, rows.filter(row => row.decision.gate === status).length,
      ])),
      budget: this.budget(), pending: this.pending(role).map(request => request.id),
      baseline: baseline?.decision.objectives ?? null, pareto,
    };
  }
}
