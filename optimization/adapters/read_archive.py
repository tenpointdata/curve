"""Verify historical TopoLoop receipts with their original JSON encoding."""

import hashlib
import json
from pathlib import Path
import sys


def digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def read_truss(root):
    contract = json.loads((root / "contract.json").read_text())
    contract_id = digest(contract)
    if contract["physics"]["adapter"] != "synthetic-truss/1":
        raise ValueError("Expected a synthetic-truss/1 archive")
    summary = json.loads((root / "summary.json").read_text())
    if summary["contract_sha256"] != contract_id:
        raise ValueError("Summary contract mismatch")

    rows = []
    previous = None
    designs = set()
    for index, file in enumerate(sorted((root / "receipts").glob("*.json"))):
        row = json.loads(file.read_text())
        expected = digest({key: value for key, value in row.items() if key != "receipt_sha256"})
        if (file.name != f"{index:06d}.json" or row["number"] != index
                or row["previous"] != previous or row["contract"] != contract_id
                or row["policy_sha256"] != contract["policy_sha256"]
                or row["receipt_sha256"] != expected):
            raise ValueError(f"Broken receipt chain at {file.name}")

        evaluation = row["evaluation"]
        members = evaluation["design"]["members"]
        if members != sorted(set(members)) or any(
            type(member) is not int or not 0 <= member < len(contract["physics"]["edges"])
            for member in members
        ):
            raise ValueError(f"Invalid design at {file.name}")
        artifact = digest(evaluation["design"])
        parent = row["parent_design"]
        if artifact in designs or (parent not in designs if index else parent is not None):
            raise ValueError(f"Invalid candidate ancestry at {file.name}")
        designs.add(artifact)
        previous = expected
        rows.append({
            "number": index, "artifact": artifact, "parent": parent, "evidence": expected,
            "measurements": evaluation["measurements"], "errors": evaluation["errors"],
            "fidelity": evaluation["evidence"].get("fidelity"),
            "cases": evaluation["evidence"].get("cases", []),
        })
    if not rows or len(rows) != summary["evaluated"] or len(rows) > contract["budget"]:
        raise ValueError("Archive count does not match the recorded budget or summary")
    return {"contract": contract, "source": contract_id, "rows": rows}


def read_frame(root):
    summary_bytes = (root / "summary.json").read_bytes()
    contract_bytes = (root / "search" / "contract.json").read_bytes()
    summary = json.loads(summary_bytes)
    contract = json.loads(contract_bytes)
    if (summary["schema"] != "provisional.search-summary/1"
            or digest(contract) != summary["contract_sha256"]
            or len(summary["records"]) != summary["evaluated"]):
        raise ValueError("Provisional DARC summary and search contract do not match")

    receipts = {}
    for row in summary["records"]:
        number = row["number"]
        if (type(number) is not int or number < 0 or number in receipts
                or row["contract_sha256"] != summary["contract_sha256"]
                or digest(row["parameters"]) != row["parameter_sha256"]):
            raise ValueError(f"Invalid DARC candidate identity {number}")
        path = root / "search" / "candidates" / f"{number:06d}" / "receipt.json"
        encoded = path.read_bytes()
        if json.loads(encoded) != row:
            raise ValueError(f"DARC summary disagrees with candidate receipt {number}")
        receipts[number] = hashlib.sha256(encoded).hexdigest()
    return {
        "summary": summary,
        "summaryHash": hashlib.sha256(summary_bytes).hexdigest(),
        "searchHash": hashlib.sha256(contract_bytes).hexdigest(),
        "gates": contract["required_gates"],
        "receipts": receipts,
    }


if __name__ == "__main__":
    reader = {"truss": read_truss, "frame": read_frame}[sys.argv[1]]
    print(json.dumps(reader(Path(sys.argv[2])), allow_nan=False))
