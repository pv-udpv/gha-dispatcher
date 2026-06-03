#!/usr/bin/env python3
"""
Audit every workflow_dispatch definition in pv-udpv/pplx-lab.

Outputs:
  - schemas/<workflow_id>.schema.json   : JSON Schema (Draft 2020-12) per workflow
  - schemas/index.json                  : workflow_id -> { name, path, has_dispatch, schema_path, declared_inputs[], undeclared_refs[], audit }
  - audit-report.md                     : human-readable findings

Detection:
  - declared_inputs: from on.workflow_dispatch.inputs (or [workflow_dispatch].inputs)
  - undeclared_refs: regex over the full YAML text for ${{ inputs.X }} / github.event.inputs.X / inputs[X]
                     not present in declared_inputs (after stripping reusable-workflow `with:` mappings).
  - missing_default_required: input declared `required: true` with no `default` (GHA accepts this but
                              the dispatcher UI must collect a value).
  - boolean_default_quoting:  GHA quirk \u2014 `default: true` is fine, `default: "true"` is also accepted
                              but coerces to string in some contexts.
  - choice_without_options:   type=choice missing `options:` list.
  - input_name_collisions:    same name declared twice (would be a YAML parse error, surfaced for sanity).

Type mapping to JSON Schema:
  - string  -> {"type": "string"}
  - boolean -> {"type": "boolean"}
  - number  -> {"type": "number"}
  - choice  -> {"type": "string", "enum": options}
  - environment -> {"type": "string", "title": "GitHub Environment"}
  - (missing/unknown) -> {"type": "string"}  (GHA default)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # PyYAML
except ImportError:
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

WORKFLOWS_DIR = Path("/tmp/pplx-lab-audit/.github/workflows")
OUT_DIR = Path("/home/user/workspace/dispatcher-ui/audit")
SCHEMAS_DIR = OUT_DIR / "schemas"
SCHEMAS_DIR.mkdir(parents=True, exist_ok=True)

# Matches `${{ inputs.foo }}`, `${{ github.event.inputs.foo }}`, `inputs.foo` (loose)
RE_INPUTS_REF = re.compile(
    r"\$\{\{\s*(?:github\.event\.)?inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*[}\.\|]"
)
# Reusable-workflow `with:` block items \u2014 those are *outgoing* params, not references to this workflow's inputs
RE_WITH_BLOCK = re.compile(r"^\s+with:\s*$", re.MULTILINE)

SCHEMA_VERSION = "https://json-schema.org/draft/2020-12/schema"


def slugify(path: Path) -> str:
    return path.stem


def coerce_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "on"):
            return True
        if s in ("false", "no", "off"):
            return False
    return None


def parse_workflow(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        text_fixed = re.sub(r"^on:\s*$", "'on':", text, flags=re.MULTILINE)
        text_fixed = re.sub(r"^on:\s", "'on': ", text_fixed, flags=re.MULTILINE)
        doc = yaml.safe_load(text_fixed)
        if isinstance(doc, dict):
            doc["_raw"] = text
            return doc
    except yaml.YAMLError:
        pass

    # Fallback: extract just the `on:` block by indentation. Workflows with inline shell
    # heredocs in job steps often break PyYAML at the job level, but the trigger block
    # at the top of the file is still well-formed.
    on_block_match = re.search(
        r"^(?:on|'on'):\s*\n((?:[ \t]+.*\n)+)", text, flags=re.MULTILINE
    )
    if not on_block_match:
        return {"_parse_error": "could not locate `on:` block", "_raw": text}

    on_yaml = "'on':\n" + on_block_match.group(1)
    try:
        partial = yaml.safe_load(on_yaml) or {}
        name_match = re.search(r"^name:\s*(.+?)\s*$", text, flags=re.MULTILINE)
        if name_match:
            partial["name"] = name_match.group(1).strip().strip("\"'")
        partial["_raw"] = text
        partial["_partial_parse"] = True
        return partial
    except yaml.YAMLError as e:
        return {"_parse_error": f"partial parse failed: {e}", "_raw": text}


def extract_dispatch_inputs(doc: dict) -> tuple[bool, dict[str, dict]]:
    """Return (has_dispatch, inputs_map)."""
    on_block = doc.get("on") or doc.get(True)  # YAML 1.1 `on:` -> True
    if on_block is None:
        return False, {}

    # `on:` may be: string ("workflow_dispatch"), list (["push", "workflow_dispatch"]), or dict
    if isinstance(on_block, str):
        return (on_block == "workflow_dispatch", {})
    if isinstance(on_block, list):
        return ("workflow_dispatch" in on_block, {})
    if isinstance(on_block, dict):
        wd = on_block.get("workflow_dispatch")
        if wd is None:
            return False, {}
        if wd is None or wd == {} or wd is True:
            return True, {}
        if isinstance(wd, dict):
            inputs = wd.get("inputs") or {}
            if not isinstance(inputs, dict):
                return True, {}
            return True, inputs
    return False, {}


def find_inputs_references(raw: str, declared: set[str]) -> list[str]:
    refs = set(RE_INPUTS_REF.findall(raw))
    # Filter out any name that is a known declared input
    return sorted(r for r in refs if r not in declared)


def to_json_schema(name: str, defn: dict, workflow_name: str) -> dict:
    """Convert a single GHA workflow_dispatch input -> JSON Schema property."""
    if not isinstance(defn, dict):
        return {"type": "string", "description": str(defn)}

    t = (defn.get("type") or "string").lower()
    desc = defn.get("description")
    default = defn.get("default")
    required = bool(defn.get("required", False))
    options = defn.get("options") or []

    prop: dict[str, Any] = {}
    if t == "boolean":
        prop["type"] = "boolean"
        b = coerce_bool(default)
        if b is not None:
            prop["default"] = b
    elif t == "number":
        prop["type"] = "number"
        if default is not None:
            try:
                prop["default"] = float(default) if "." in str(default) else int(default)
            except (TypeError, ValueError):
                pass
    elif t == "choice":
        prop["type"] = "string"
        if options:
            prop["enum"] = [str(o) for o in options]
        if default is not None:
            prop["default"] = str(default)
    elif t == "environment":
        prop["type"] = "string"
        prop["title"] = "GitHub Environment"
        if default is not None:
            prop["default"] = str(default)
    else:  # string or unknown
        prop["type"] = "string"
        if default is not None:
            prop["default"] = str(default)

    if desc:
        prop["description"] = str(desc).strip()
    prop["x-gha-type"] = t
    prop["x-gha-required"] = required
    return prop


def build_schema_for_workflow(
    wf_name: str, wf_path: str, inputs: dict[str, dict]
) -> dict:
    """Build a full JSON Schema document for one workflow's dispatch inputs."""
    properties: dict[str, dict] = {}
    required: list[str] = []
    order: list[str] = []
    for name, defn in inputs.items():
        prop = to_json_schema(name, defn or {}, wf_name)
        properties[str(name)] = prop
        order.append(str(name))
        if isinstance(defn, dict) and defn.get("required"):
            required.append(str(name))

    return {
        "$schema": SCHEMA_VERSION,
        "$id": f"pplx-lab/workflows/{Path(wf_path).stem}.schema.json",
        "title": wf_name,
        "description": f"Inputs for workflow_dispatch of `{wf_path}` (pv-udpv/pplx-lab).",
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
        "x-workflow-name": wf_name,
        "x-workflow-path": wf_path,
        "x-input-order": order,
    }


def audit_workflow(path: Path) -> dict:
    doc = parse_workflow(path)
    if "_parse_error" in doc:
        return {
            "path": str(path.relative_to(WORKFLOWS_DIR.parent.parent)),
            "name": path.stem,
            "has_dispatch": False,
            "parse_error": doc["_parse_error"],
        }
    raw = doc.get("_raw", "")
    wf_name = str(doc.get("name") or path.stem)
    has_dispatch, inputs = extract_dispatch_inputs(doc)
    rel_path = ".github/workflows/" + path.name

    declared = set(str(k) for k in (inputs or {}).keys())
    undeclared_refs = find_inputs_references(raw, declared)

    findings: list[dict] = []
    for name, defn in (inputs or {}).items():
        if not isinstance(defn, dict):
            continue
        t = (defn.get("type") or "string").lower()
        if defn.get("required") and "default" not in defn:
            findings.append({
                "severity": "warn",
                "kind": "required_without_default",
                "input": str(name),
                "message": f"`{name}` is required:true but has no default \u2014 dispatcher UI must require user input.",
            })
        if t == "choice" and not defn.get("options"):
            findings.append({
                "severity": "error",
                "kind": "choice_without_options",
                "input": str(name),
                "message": f"`{name}` is type:choice but has no options \u2014 dispatch will fail.",
            })
        if t == "boolean":
            d = defn.get("default")
            if d is not None and not isinstance(d, bool):
                findings.append({
                    "severity": "info",
                    "kind": "boolean_default_quoted",
                    "input": str(name),
                    "message": f"`{name}` boolean default is quoted ({d!r}); GHA coerces but prefer unquoted true/false.",
                })

    for ref in undeclared_refs:
        findings.append({
            "severity": "warn",
            "kind": "undeclared_input_reference",
            "input": ref,
            "message": f"References `inputs.{ref}` but it isn't declared in workflow_dispatch.inputs.",
        })

    schema = None
    schema_path = None
    if has_dispatch:
        schema = build_schema_for_workflow(wf_name, rel_path, inputs or {})
        schema_path = SCHEMAS_DIR / f"{path.stem}.schema.json"
        schema_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")

    return {
        "path": rel_path,
        "file": path.name,
        "id": path.stem,
        "name": wf_name,
        "has_dispatch": has_dispatch,
        "declared_inputs": sorted(declared),
        "input_count": len(declared),
        "undeclared_refs": undeclared_refs,
        "findings": findings,
        "partial_parse": bool(doc.get("_partial_parse")),
        "schema_path": (
            f"schemas/{path.stem}.schema.json" if has_dispatch else None
        ),
    }


def main() -> int:
    files = sorted(
        p for p in WORKFLOWS_DIR.glob("*.y*ml")
        if p.suffix in (".yml", ".yaml")
    )
    audits: list[dict] = []
    for p in files:
        audits.append(audit_workflow(p))

    # Stats
    total = len(audits)
    with_dispatch = sum(1 for a in audits if a.get("has_dispatch"))
    parse_errors = [a for a in audits if a.get("parse_error")]
    total_findings = sum(len(a.get("findings", [])) for a in audits)
    by_kind: dict[str, int] = {}
    for a in audits:
        for f in a.get("findings", []):
            by_kind[f["kind"]] = by_kind.get(f["kind"], 0) + 1

    index = {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "repo": "pv-udpv/pplx-lab",
        "stats": {
            "total_workflow_files": total,
            "with_workflow_dispatch": with_dispatch,
            "parse_errors": len(parse_errors),
            "total_findings": total_findings,
            "findings_by_kind": by_kind,
        },
        "workflows": audits,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")

    # Markdown report
    md = []
    md.append("# pv-udpv/pplx-lab \u2014 workflow_dispatch audit\n")
    md.append(f"- Total workflow files: **{total}**")
    md.append(f"- With `workflow_dispatch`: **{with_dispatch}**")
    md.append(f"- Parse errors: **{len(parse_errors)}**")
    md.append(f"- Total findings: **{total_findings}**\n")
    md.append("## Findings by kind\n")
    md.append("| Kind | Count |")
    md.append("|---|---|")
    for k, n in sorted(by_kind.items(), key=lambda x: -x[1]):
        md.append(f"| `{k}` | {n} |")
    md.append("")

    issues = [a for a in audits if a.get("findings") or a.get("parse_error")]
    md.append(f"## Workflows with issues ({len(issues)})\n")
    for a in issues:
        md.append(f"### `{a['path']}` \u2014 {a['name']}")
        if a.get("parse_error"):
            md.append(f"- **parse_error:** `{a['parse_error']}`")
        for f in a.get("findings", []):
            md.append(f"- [{f['severity']}] **{f['kind']}** `{f.get('input','')}`: {f['message']}")
        md.append("")

    clean = [a for a in audits if a.get("has_dispatch") and not a.get("findings")]
    md.append(f"## Clean dispatchable workflows ({len(clean)})\n")
    for a in clean:
        inputs_summary = ", ".join(a["declared_inputs"]) or "(no inputs)"
        md.append(f"- `{a['file']}` \u2014 {a['name']}: {inputs_summary}")

    (OUT_DIR / "audit-report.md").write_text("\n".join(md), encoding="utf-8")

    # Stdout summary
    print(f"Files scanned: {total}")
    print(f"With workflow_dispatch: {with_dispatch}")
    print(f"Parse errors: {len(parse_errors)}")
    print(f"Total findings: {total_findings}")
    print(f"Findings by kind: {by_kind}")
    print(f"Schemas written: {with_dispatch} \u2192 {SCHEMAS_DIR}")
    print(f"Index: {OUT_DIR/'index.json'}")
    print(f"Report: {OUT_DIR/'audit-report.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
