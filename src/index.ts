interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * California State Procurement MCP — State contract awards & purchase orders (keyless).
 *
 * Wraps the official California Open Data portal (data.ca.gov, CKAN) "Purchase Order
 * Data" dataset — an extract from the State Contract and Procurement Registration
 * System (SCPRS) covering State contracts/purchases. Every row is a State purchase
 * order / contract award with an awarding department (agency), a winning supplier
 * (vendor), a dollar amount, and dates.
 *
 *   Dataset:  https://data.ca.gov/dataset/purchase-order-data
 *   Resource: bb82edc5-9c78-44e2-8947-68ece26197c5  (fiscal years 2012-13 .. 2014-15)
 *
 * Keyless. Uses CKAN's datastore_search_sql (read-only Postgres) so we can filter and
 * rank by parsed dollar amount and aggregate a supplier's total State spend. An optional
 * CKAN API key may be passed as args._apiKey (sent as the Authorization header) but is
 * not required for this public dataset.
 *
 * All tools return shaped, LLM-friendly objects and never throw — failures resolve to
 * { error }. Tool prefix: ca_procurement_.
 */


const BASE = 'https://data.ca.gov/api/3/action';
const RESOURCE = 'bb82edc5-9c78-44e2-8947-68ece26197c5';
const UA = 'pipeworx-mcp-ca-procurement/1.0 (+https://pipeworx.io)';
const SOURCE = 'data.ca.gov — Purchase Order Data (State Contract and Procurement Registration System, FY2012-13..2014-15)';

// SQL expression that turns the text "Total Price" field ("$1,234.00 ") into a numeric dollar amount.
const AMOUNT = `regexp_replace("Total Price", '[^0-9.]', '', 'g')::numeric`;
// Guard for aggregations that SUM ${AMOUNT} across many rows: an empty/dashes-only
// "Total Price" cleans to "" and ""::numeric throws, killing the whole query. Only
// cast rows that contain a digit. (NULLIF is not whitelisted by CKAN's SQL endpoint.)
const HAS_AMOUNT = `"Total Price" ~ '[0-9]'`;

const tools: McpToolExport['tools'] = [
  {
    name: 'ca_procurement_awards',
    description:
      "Search California STATE government contract awards & purchase orders from the official State Contract and Procurement Registration System (SCPRS) on data.ca.gov. Each result is a State purchase order / award with its awarding department (agency), the winning supplier (vendor), the dollar amount, acquisition type/method, item description, and dates. Filter by supplier, department/agency, keyword, fiscal year, acquisition type, and/or a minimum amount; results are ranked by dollar amount (biggest awards first) by default. Use this for questions like \"who won California state contracts\", \"biggest suppliers to the CA Department of Health Care Services\", or \"CA state purchase orders for laptops\". This is CALIFORNIA STATE data (not federal).",
    inputSchema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'Winning supplier / vendor name to match (case-insensitive substring), e.g. "Microsoft", "Pitney Bowes".' },
        department: { type: 'string', description: 'Awarding State department / agency name (case-insensitive substring), e.g. "Health Care Services", "Transportation".' },
        keyword: { type: 'string', description: 'Case-insensitive substring to match against the item name/description, e.g. "laptop", "consulting".' },
        fiscal_year: { type: 'string', description: 'Exact state fiscal year, e.g. "2014-2015" (available: 2012-2013, 2013-2014, 2014-2015).' },
        acquisition_type: { type: 'string', description: 'Acquisition type substring, e.g. "IT Goods", "NON-IT Services", "IT Services".' },
        min_amount: { type: ['number', 'string'], description: 'Only return awards whose total price is at least this many dollars, e.g. 100000.' },
        sort: { type: 'string', enum: ['amount', 'date'], description: 'Sort order: "amount" = largest award first (default), "date" = most recent creation date first.' },
        limit: { type: ['number', 'string'], description: 'Max records to return (default 20, max 100).' },
        offset: { type: ['number', 'string'], description: 'Number of records to skip for pagination (default 0).' },
      },
    },
  },
  {
    name: 'ca_procurement_supplier',
    description:
      "Aggregate a supplier's California STATE contract awards from the SCPRS purchase-order data on data.ca.gov: total dollars awarded, number of purchase orders, and a breakdown by awarding department (agency) and by fiscal year. Matches the supplier name as a case-insensitive substring, so it also surfaces name variants (e.g. \"Pitney Bowes\" vs \"Pitney Bowes, Inc\"). Use this to size up a single vendor's business with the State of California. This is CALIFORNIA STATE data (not federal).",
    inputSchema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'Supplier / vendor name to aggregate (case-insensitive substring), e.g. "Deloitte", "Dell".' },
        fiscal_year: { type: 'string', description: 'Optional: restrict to one fiscal year, e.g. "2014-2015".' },
      },
      required: ['supplier'],
    },
  },
  {
    name: 'ca_procurement_top_suppliers',
    description:
      "Rank the biggest suppliers (vendors) to the State of California by total contract/purchase-order dollars, from the SCPRS purchase-order data on data.ca.gov. Answers \"who are California's largest state contractors / award winners\", optionally scoped to a department/agency, a fiscal year, an acquisition type, or an item keyword. Returns each supplier with total dollars awarded and purchase-order count, largest first. This is CALIFORNIA STATE data (not federal).",
    inputSchema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Optional: restrict to one awarding department/agency (case-insensitive substring), e.g. "Health Care Services".' },
        fiscal_year: { type: 'string', description: 'Optional exact fiscal year, e.g. "2014-2015".' },
        acquisition_type: { type: 'string', description: 'Optional acquisition-type substring, e.g. "IT Goods", "IT Services".' },
        keyword: { type: 'string', description: 'Optional item name/description substring, e.g. "software", "consulting".' },
        limit: { type: ['number', 'string'], description: 'How many top suppliers to return (default 20, max 100).' },
      },
    },
  },
  {
    name: 'ca_procurement_department',
    description:
      "Profile a California STATE department/agency's procurement spend from the SCPRS purchase-order data on data.ca.gov: total dollars, purchase-order count, top suppliers (vendors) it buys from, top commodity categories it spends on, and a by-fiscal-year breakdown. Matches the department name as a case-insensitive substring. Answers \"what does the CA Department of Justice buy and from whom\", \"which agencies spend the most\". This is CALIFORNIA STATE data (not federal).",
    inputSchema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'State department/agency name (case-insensitive substring), e.g. "Justice", "Health Care Services", "Transportation".' },
        fiscal_year: { type: 'string', description: 'Optional: restrict to one fiscal year, e.g. "2014-2015".' },
      },
      required: ['department'],
    },
  },
  {
    name: 'ca_procurement_commodities',
    description:
      "Rank what the State of California spends the most on, by commodity category (UNSPSC commodity title), from the SCPRS purchase-order data on data.ca.gov. Returns each category with total dollars and purchase-order count, largest first, optionally scoped to a department/agency or fiscal year. Answers \"what does California buy the most of\", \"top spending categories for the CA Department of Health Care Services\". This is CALIFORNIA STATE data (not federal).",
    inputSchema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Optional: restrict to one awarding department/agency (case-insensitive substring).' },
        fiscal_year: { type: 'string', description: 'Optional exact fiscal year, e.g. "2014-2015".' },
        limit: { type: ['number', 'string'], description: 'How many categories to return (default 20, max 100).' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'ca_procurement_awards':
        return await searchAwards(args);
      case 'ca_procurement_supplier':
        return await supplierSummary(args);
      case 'ca_procurement_top_suppliers':
        return await topSuppliers(args);
      case 'ca_procurement_department':
        return await departmentProfile(args);
      case 'ca_procurement_commodities':
        return await commodities(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function searchAwards(args: Record<string, unknown>): Promise<unknown> {
  const limit = clampInt(args.limit, 20, 1, 100);
  const offset = clampInt(args.offset, 0, 0, 1_000_000);
  const where: string[] = [];
  const supplier = strArg(args.supplier);
  const department = strArg(args.department);
  const keyword = strArg(args.keyword);
  const fiscalYear = strArg(args.fiscal_year);
  const acqType = strArg(args.acquisition_type);
  const minAmount = numArg(args.min_amount);

  if (supplier) where.push(`"Supplier Name" ILIKE ${lit(`%${supplier}%`)}`);
  if (department) where.push(`"Department Name" ILIKE ${lit(`%${department}%`)}`);
  if (keyword) where.push(`("Item Name" ILIKE ${lit(`%${keyword}%`)} OR "Item Description" ILIKE ${lit(`%${keyword}%`)})`);
  if (fiscalYear) where.push(`"Fiscal Year" = ${lit(fiscalYear)}`);
  if (acqType) where.push(`"Acquisition Type" ILIKE ${lit(`%${acqType}%`)}`);
  if (minAmount != null) where.push(`${AMOUNT} >= ${minAmount}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = strArg(args.sort) === 'date' ? '"Creation Date" DESC' : `${AMOUNT} DESC`;
  const sql =
    `SELECT "Purchase Order Number", "Requisition Number", "Creation Date", "Purchase Date", ` +
    `"Fiscal Year", "Department Name", "Supplier Name", "Supplier Code", "Acquisition Type", ` +
    `"Acquisition Method", "Item Name", "Item Description", "Quantity", "Unit Price", ` +
    `"Total Price", "Normalized UNSPSC" ` +
    `FROM "${RESOURCE}" ${whereSql} ORDER BY ${orderSql} LIMIT ${limit} OFFSET ${offset}`;

  const records = await sqlSearch(sql, args);
  const awards = records.map((r) => ({
    po_number: pick(r, 'Purchase Order Number'),
    requisition_number: pick(r, 'Requisition Number'),
    supplier: pick(r, 'Supplier Name'),
    supplier_code: pick(r, 'Supplier Code'),
    department: pick(r, 'Department Name'),
    acquisition_type: pick(r, 'Acquisition Type'),
    acquisition_method: pick(r, 'Acquisition Method'),
    item: pick(r, 'Item Name'),
    description: pick(r, 'Item Description'),
    quantity: pick(r, 'Quantity'),
    unit_price: pick(r, 'Unit Price'),
    amount: parseMoney(pick(r, 'Total Price')),
    amount_text: pick(r, 'Total Price'),
    creation_date: pick(r, 'Creation Date'),
    purchase_date: pick(r, 'Purchase Date'),
    fiscal_year: pick(r, 'Fiscal Year'),
    unspsc: pick(r, 'Normalized UNSPSC'),
    raw: r,
  }));
  return { source: SOURCE, limit, offset, count: awards.length, awards };
}

async function supplierSummary(args: Record<string, unknown>): Promise<unknown> {
  const supplier = strArg(args.supplier);
  if (!supplier) throw new Error('Required argument "supplier" is missing. Pass a vendor name like "Deloitte".');
  const fiscalYear = strArg(args.fiscal_year);

  const cond = [`"Supplier Name" ILIKE ${lit(`%${supplier}%`)}`];
  if (fiscalYear) cond.push(`"Fiscal Year" = ${lit(fiscalYear)}`);
  const whereSql = `WHERE ${cond.join(' AND ')}`;

  const agg = (col: string, limit = 50) =>
    `SELECT ${col}, count(*) orders, sum(${AMOUNT}) amount FROM "${RESOURCE}" ${whereSql} ` +
    `GROUP BY ${col} ORDER BY amount DESC NULLS LAST LIMIT ${limit}`;

  const [byName, byDept, byYear] = await Promise.all([
    sqlSearch(agg('"Supplier Name"'), args),
    sqlSearch(agg('"Department Name"', 25), args),
    sqlSearch(agg('"Fiscal Year"'), args),
  ]);

  if (byName.length === 0) {
    return { source: SOURCE, supplier_query: supplier, matched: false, message: `No California state purchase orders found for a supplier matching "${supplier}".` };
  }

  const total_orders = byName.reduce((s, r) => s + toInt(pick(r, 'orders')), 0);
  const total_amount = byName.reduce((s, r) => s + toNum(pick(r, 'amount')), 0);

  const shape = (rows: Record<string, any>[], key: string, keyOut: string) =>
    rows.map((r) => ({ [keyOut]: pick(r, key), orders: toInt(pick(r, 'orders')), amount: toNum(pick(r, 'amount')) }));

  return {
    source: SOURCE,
    supplier_query: supplier,
    matched: true,
    total_orders,
    total_amount,
    matched_supplier_names: shape(byName, 'Supplier Name', 'supplier'),
    by_department: shape(byDept, 'Department Name', 'department'),
    by_fiscal_year: shape(byYear, 'Fiscal Year', 'fiscal_year'),
  };
}

// Shared filter builder for the aggregation tools. Every aggregation SUMs
// ${AMOUNT}, so HAS_AMOUNT is always included to skip un-castable rows.
function aggWhere(args: Record<string, unknown>, opts: { department?: boolean; keyword?: boolean; acqType?: boolean } = {}): string {
  const cond = [HAS_AMOUNT];
  const department = strArg(args.department);
  const fiscalYear = strArg(args.fiscal_year);
  const keyword = strArg(args.keyword);
  const acqType = strArg(args.acquisition_type);
  if (opts.department !== false && department) cond.push(`"Department Name" ILIKE ${lit(`%${department}%`)}`);
  if (fiscalYear) cond.push(`"Fiscal Year" = ${lit(fiscalYear)}`);
  if (opts.keyword && keyword) cond.push(`("Item Name" ILIKE ${lit(`%${keyword}%`)} OR "Item Description" ILIKE ${lit(`%${keyword}%`)})`);
  if (opts.acqType && acqType) cond.push(`"Acquisition Type" ILIKE ${lit(`%${acqType}%`)}`);
  return `WHERE ${cond.join(' AND ')}`;
}

const shapeAgg = (rows: Record<string, any>[], key: string, keyOut: string) =>
  rows.map((r) => ({ [keyOut]: pick(r, key), orders: toInt(pick(r, 'orders')), amount: toNum(pick(r, 'amount')) }));

async function topSuppliers(args: Record<string, unknown>): Promise<unknown> {
  const limit = clampInt(args.limit, 20, 1, 100);
  const whereSql = aggWhere(args, { keyword: true, acqType: true });
  const sql =
    `SELECT "Supplier Name", count(*) orders, sum(${AMOUNT}) amount FROM "${RESOURCE}" ${whereSql} ` +
    `AND "Supplier Name" IS NOT NULL GROUP BY "Supplier Name" ORDER BY amount DESC NULLS LAST LIMIT ${limit}`;
  const rows = await sqlSearch(sql, args);
  return {
    source: SOURCE,
    scope: {
      department: strArg(args.department) ?? null,
      fiscal_year: strArg(args.fiscal_year) ?? null,
      acquisition_type: strArg(args.acquisition_type) ?? null,
      keyword: strArg(args.keyword) ?? null,
    },
    count: rows.length,
    top_suppliers: shapeAgg(rows, 'Supplier Name', 'supplier'),
  };
}

async function departmentProfile(args: Record<string, unknown>): Promise<unknown> {
  const department = strArg(args.department);
  if (!department) throw new Error('Required argument "department" is missing. Pass an agency name like "Justice, Department of".');
  const whereSql = aggWhere(args);

  const agg = (col: string, limit: number) =>
    `SELECT ${col}, count(*) orders, sum(${AMOUNT}) amount FROM "${RESOURCE}" ${whereSql} ` +
    `AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY amount DESC NULLS LAST LIMIT ${limit}`;

  const [byDept, bySupplier, byCommodity, byYear] = await Promise.all([
    sqlSearch(agg('"Department Name"', 25), args),
    sqlSearch(agg('"Supplier Name"', 20), args),
    sqlSearch(agg('"Commodity Title"', 20), args),
    sqlSearch(agg('"Fiscal Year"', 10), args),
  ]);

  if (byDept.length === 0) {
    return { source: SOURCE, department_query: department, matched: false, message: `No California state purchase orders found for a department matching "${department}".` };
  }
  const total_orders = byDept.reduce((s, r) => s + toInt(pick(r, 'orders')), 0);
  const total_amount = byDept.reduce((s, r) => s + toNum(pick(r, 'amount')), 0);
  return {
    source: SOURCE,
    department_query: department,
    matched: true,
    total_orders,
    total_amount,
    matched_departments: shapeAgg(byDept, 'Department Name', 'department'),
    top_suppliers: shapeAgg(bySupplier, 'Supplier Name', 'supplier'),
    top_commodities: shapeAgg(byCommodity, 'Commodity Title', 'commodity'),
    by_fiscal_year: shapeAgg(byYear, 'Fiscal Year', 'fiscal_year'),
  };
}

async function commodities(args: Record<string, unknown>): Promise<unknown> {
  const limit = clampInt(args.limit, 20, 1, 100);
  const whereSql = aggWhere(args);
  const sql =
    `SELECT "Commodity Title", count(*) orders, sum(${AMOUNT}) amount FROM "${RESOURCE}" ${whereSql} ` +
    `AND "Commodity Title" IS NOT NULL GROUP BY "Commodity Title" ORDER BY amount DESC NULLS LAST LIMIT ${limit}`;
  const rows = await sqlSearch(sql, args);
  return {
    source: SOURCE,
    scope: { department: strArg(args.department) ?? null, fiscal_year: strArg(args.fiscal_year) ?? null },
    count: rows.length,
    top_commodities: shapeAgg(rows, 'Commodity Title', 'commodity'),
  };
}

async function sqlSearch(sql: string, args: Record<string, unknown>): Promise<Record<string, any>[]> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
  const apiKey = strArg(args._apiKey);
  if (apiKey) headers.Authorization = apiKey; // optional CKAN key; not required for public data

  const url = `${BASE}/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw new Error(`CA procurement request failed (network): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 429) throw new Error('CA procurement rate-limited (HTTP 429). Retry shortly or pass a CKAN API key as _apiKey.');
  if (res.status === 404) throw new Error('CA procurement dataset not found (HTTP 404) — the data.ca.gov resource may have moved.');
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`CA procurement error: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error('CA procurement returned a non-JSON response.');
  }
  if (data?.success === false) {
    const msg = data?.error?.message || JSON.stringify(data?.error || {}).slice(0, 200);
    throw new Error(`CA procurement query rejected: ${msg}`);
  }
  return data?.result?.records ?? [];
}

// ---- helpers ----

function pick(obj: Record<string, any>, key: string): any {
  const v = obj?.[key];
  return v === undefined || v === '' ? null : v;
}

function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toInt(v: unknown): number {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

// Escape a value for a single-quoted SQL string literal (Postgres standard quoting).
function lit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function numArg(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  let n: number;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.floor(v);
  else if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) n = Math.floor(Number(v));
  else return def;
  return Math.min(max, Math.max(min, n));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
