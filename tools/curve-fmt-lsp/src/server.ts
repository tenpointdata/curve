#!/usr/bin/env node
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeResult,
  type TextEdit,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { formatCurve } from "./formatter.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    documentFormattingProvider: true,
  },
  serverInfo: { name: "curve2-fmt-lsp", version: "0.1.0" },
}));

connection.onDocumentFormatting((params): TextEdit[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document || (document.languageId !== "curve" && document.languageId !== "curve2")) return [];
  const source = document.getText();
  const formatted = formatCurve(source, params.options);
  if (formatted === source) return [];
  return [{
    range: { start: { line: 0, character: 0 }, end: document.positionAt(source.length) },
    newText: formatted,
  }];
});

documents.listen(connection);
connection.listen();
