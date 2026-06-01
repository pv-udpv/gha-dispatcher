// Configure Monaco to load from CDN instead of bundling the 4 MB workers.
// This module must be imported statically BEFORE the Monaco editor is used.
import { loader } from "@monaco-editor/react";

loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs" },
});
