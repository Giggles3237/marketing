from __future__ import annotations

import json
import re
import sys
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List
from xml.etree import ElementTree as ET


SHEET_NAMES = [
    "BMW Sales",
    "MINI Sales",
    "BMW Service",
    "MINI Service",
]
DEPARTMENT_ORDER = ["BMW Sales", "MINI Sales", "BMW Service", "MINI Service", "Collision"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
CELL_REF_RE = re.compile(r"([A-Z]+)(\d+)")


def col_to_index(col_name: str) -> int:
    value = 0
    for char in col_name:
        value = value * 26 + ord(char) - 64
    return value


def read_shared_strings(archive: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
        for si in root.findall("a:si", NS)
    ]


def read_workbook_map(archive: zipfile.ZipFile) -> Dict[str, str]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    targets: Dict[str, str] = {}
    for sheet in workbook.find("a:sheets", NS) or []:
        name = sheet.attrib["name"]
        rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        targets[name] = f"xl/{rel_map[rel_id]}"
    return targets


def cell_value(cell: ET.Element, shared_strings: List[str]) -> str:
    value_node = cell.find("a:v", NS)
    if value_node is None or value_node.text is None:
        return ""
    raw = value_node.text
    return shared_strings[int(raw)] if cell.attrib.get("t") == "s" else raw


def read_sheet_rows(archive: zipfile.ZipFile, target: str, shared_strings: List[str]) -> Dict[int, Dict[int, str]]:
    root = ET.fromstring(archive.read(target))
    rows: Dict[int, Dict[int, str]] = {}
    for row in root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row"):
        row_index = int(row.attrib["r"])
        row_values: Dict[int, str] = {}
        for cell in row.findall("a:c", NS):
            match = CELL_REF_RE.match(cell.attrib["r"])
            if not match:
                continue
            row_values[col_to_index(match.group(1))] = cell_value(cell, shared_strings)
        rows[row_index] = row_values
    return rows


def to_float(value: str) -> float:
    if not value:
        return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def normalize_category(raw: str, vendor_name: str, department: str) -> str:
    label = (raw or "").strip()
    if label:
        return label
    service_vendors = {"xtime", "fleet street", "stream companies"}
    vendor_lower = vendor_name.lower()
    if "event" in department.lower():
        return "Events"
    if any(name in vendor_lower for name in service_vendors):
        return "Service"
    return "Other"


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@dataclass
class BudgetRecord:
    department: str
    category: str
    vendor_name: str
    coop_rate: float
    contract_rate: float
    monthly_budget: List[float]
    monthly_actual: List[float]
    display_order: int
    source_row: int

    def as_dict(self) -> Dict[str, object]:
        annual_budget = round(sum(self.monthly_budget), 2)
        annual_actual = round(sum(self.monthly_actual), 2)
        coop_amount = round(annual_actual * self.coop_rate, 2)
        return {
            "id": f"{slugify(self.department)}-{slugify(self.vendor_name)}",
            "department": self.department,
            "category": self.category,
            "vendor_name": self.vendor_name,
            "coop_rate": self.coop_rate,
            "contract_rate": self.contract_rate,
            "year": 2026,
            "monthly_budget": [round(value, 2) for value in self.monthly_budget],
            "monthly_actual": [round(value, 2) for value in self.monthly_actual],
            "display_order": self.display_order,
            "source_row": self.source_row,
            "annual_budget": annual_budget,
            "annual_actual": annual_actual,
            "annual_variance": round(annual_budget - annual_actual, 2),
            "coop_amount": coop_amount,
            "net_cost": round(annual_actual - coop_amount, 2),
        }


def parse_budget_sheet(rows: Dict[int, Dict[int, str]], department: str) -> List[BudgetRecord]:
    records: List[BudgetRecord] = []
    current_category = ""
    display_order = 0
    for row_index in sorted(rows):
        row = rows[row_index]
        vendor_name = row.get(2, "").strip()
        category_label = row.get(1, "").strip()
        if row_index < 5:
            continue
        if category_label and not vendor_name:
            current_category = category_label
            continue
        if not vendor_name or vendor_name.startswith("TOTAL ") or vendor_name == "GRAND TOTAL":
            continue
        budgets = [to_float(row.get(5 + month * 3, "")) for month in range(12)]
        actuals = [to_float(row.get(6 + month * 3, "")) for month in range(12)]
        records.append(
            BudgetRecord(
                department=department,
                category=normalize_category(current_category, vendor_name, department),
                vendor_name=vendor_name,
                coop_rate=to_float(row.get(3, "")) / 100.0,
                contract_rate=to_float(row.get(4, "")),
                monthly_budget=budgets,
                monthly_actual=actuals,
                display_order=display_order,
                source_row=row_index,
            )
        )
        display_order += 1
    return records


def parse_contracts(rows: Dict[int, Dict[int, str]], budget_records: List[BudgetRecord]) -> List[Dict[str, object]]:
    today = datetime(2026, 4, 5)
    budget_index = {record.vendor_name: record for record in budget_records}
    vendors: List[Dict[str, object]] = []
    for row_index in sorted(rows):
        if row_index < 5:
            continue
        vendor_name = rows[row_index].get(1, "").strip()
        if not vendor_name:
            continue
        record = budget_index.get(vendor_name)
        contract_start = today - timedelta(days=365 - (row_index % 180))
        contract_end = today + timedelta(days=30 + (row_index * 11 % 240))
        monthly_rate = to_float(rows[row_index].get(3, "")) or (record.contract_rate if record else 0.0)
        previous_rate = round(monthly_rate * 0.94, 2) if monthly_rate else 0.0
        coop_rate = record.coop_rate if record else 0.0
        vendors.append(
            {
                "id": f"contract-{slugify(vendor_name)}",
                "vendor_name": vendor_name,
                "category": record.category if record else "Other",
                "departments": rows[row_index].get(2, "").strip() or (record.department if record else "Unassigned"),
                "contact_name": f"{vendor_name} Rep",
                "contact_email": f"{slugify(vendor_name)}@vendor.example",
                "monthly_rate": round(monthly_rate, 2),
                "contract_start": contract_start.strftime("%Y-%m-%d"),
                "contract_end": contract_end.strftime("%Y-%m-%d"),
                "last_price_change": (today - timedelta(days=(row_index * 13) % 150)).strftime("%Y-%m-%d"),
                "previous_rate": previous_rate,
                "coop_eligible": coop_rate > 0,
                "coop_rate": round(coop_rate, 2),
                "notes": rows[row_index].get(8, "").strip(),
                "document_url": "",
            }
        )
    return vendors


def build_roi_records(budget_records: List[BudgetRecord]) -> List[Dict[str, object]]:
    grouped: Dict[str, Dict[str, List[float]]] = {}
    for record in budget_records:
        bucket = grouped.setdefault(record.department, {"actual": [0.0] * 12, "net": [0.0] * 12})
        for idx in range(12):
            bucket["actual"][idx] += record.monthly_actual[idx]
            bucket["net"][idx] += record.monthly_actual[idx] * (1 - record.coop_rate)

    roi_records: List[Dict[str, object]] = []
    for department, totals in grouped.items():
        for month_idx, month_name in enumerate(MONTHS, start=1):
            actual = round(totals["actual"][month_idx - 1], 2)
            net = round(totals["net"][month_idx - 1], 2)
            leads = int(max(actual / 150, 12) + month_idx * 3)
            sessions = int(max(actual / 12, 220) + month_idx * 25)
            units_sold = int(max(actual / 800, 4) + (month_idx % 5))
            service_ros = int(max(actual / 100, 18) + month_idx * 4)
            roi_records.append(
                {
                    "id": f"{slugify(department)}-{month_idx}",
                    "department": department,
                    "month": month_idx,
                    "month_name": month_name,
                    "year": 2026,
                    "total_spend": actual,
                    "net_spend": net,
                    "units_sold": units_sold if "Sales" in department else 0,
                    "service_ros": service_ros if "Service" in department else 0,
                    "leads": leads,
                    "sessions": sessions,
                    "cpl": round(net / leads, 2) if leads else 0,
                    "cpu": round(net / units_sold, 2) if units_sold else 0,
                    "cpro": round(net / service_ros, 2) if service_ros else 0,
                    "cps": round(net / sessions, 2) if sessions else 0,
                }
            )
    return roi_records


def build_seed(xlsx_path: Path) -> Dict[str, object]:
    with zipfile.ZipFile(xlsx_path) as archive:
        shared_strings = read_shared_strings(archive)
        workbook_map = read_workbook_map(archive)
        budget_records: List[BudgetRecord] = []
        for sheet_name in SHEET_NAMES:
            rows = read_sheet_rows(archive, workbook_map[sheet_name], shared_strings)
            budget_records.extend(parse_budget_sheet(rows, sheet_name))
        contract_rows = read_sheet_rows(archive, workbook_map["Vendor Contracts"], shared_strings)
        contracts = parse_contracts(contract_rows, budget_records)

    return {
        "meta": {
            "title": "BMW/MINI of Pittsburgh Marketing Platform",
            "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source_workbook": str(xlsx_path),
            "year": 2026,
            "months": MONTHS,
        },
        "departments": [department for department in DEPARTMENT_ORDER if department in {record.department for record in budget_records} or department == "Collision"],
        "categories": sorted({record.category for record in budget_records} | {"Digital", "Traditional", "OEM", "Events", "Other"}),
        "budgetRecords": [record.as_dict() for record in budget_records],
        "vendorContracts": contracts,
        "roiRecords": build_roi_records(budget_records),
        "alerts": [
            {"id": "budget-overspend", "type": "variance", "threshold": 0.10},
            {"id": "contract-renewals", "type": "contract", "threshold": 90},
        ],
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python scripts/extract_seed.py <input.xlsx> <output.json>")
        return 1
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(build_seed(input_path), indent=2), encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


