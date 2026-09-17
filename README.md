# mcp-ca-procurement

California State Procurement MCP — State contract awards & purchase orders (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `ca_procurement_awards` | Search California STATE government contract awards & purchase orders from the official State Contract and Procurement Registration System (SCPRS) on data.ca.gov. Each result is a State purchase order / award with its awarding department (agency), the winning supplier (vendor), the dollar amount, acquisition type/method, item description, and dates. Filter by supplier, department/agency, keyword, fiscal year, acquisition type, and/or a minimum amount; results are ranked by dollar amount (biggest awards first) by default. Use this for questions like "who won California state contracts", "biggest suppliers to the CA Department of Health Care Services", or "CA state purchase orders for laptops". This is CALIFORNIA STATE data (not federal). |
| `ca_procurement_supplier` | Aggregate a supplier's California STATE contract awards from the SCPRS purchase-order data on data.ca.gov: total dollars awarded, number of purchase orders, and a breakdown by awarding department (agency) and by fiscal year. Matches the supplier name as a case-insensitive substring, so it also surfaces name variants (e.g. "Pitney Bowes" vs "Pitney Bowes, Inc"). Use this to size up a single vendor's business with the State of California. This is CALIFORNIA STATE data (not federal). |
| `ca_procurement_top_suppliers` | Rank the biggest suppliers (vendors) to the State of California by total contract/purchase-order dollars, from the SCPRS purchase-order data on data.ca.gov. Answers "who are California's largest state contractors / award winners", optionally scoped to a department/agency, a fiscal year, an acquisition type, or an item keyword. Returns each supplier with total dollars awarded and purchase-order count, largest first. This is CALIFORNIA STATE data (not federal). |
| `ca_procurement_department` | Profile a California STATE department/agency's procurement spend from the SCPRS purchase-order data on data.ca.gov: total dollars, purchase-order count, top suppliers (vendors) it buys from, top commodity categories it spends on, and a by-fiscal-year breakdown. Matches the department name as a case-insensitive substring. Answers "what does the CA Department of Justice buy and from whom", "which agencies spend the most". This is CALIFORNIA STATE data (not federal). |
| `ca_procurement_commodities` | Rank what the State of California spends the most on, by commodity category (UNSPSC commodity title), from the SCPRS purchase-order data on data.ca.gov. Returns each category with total dollars and purchase-order count, largest first, optionally scoped to a department/agency or fiscal year. Answers "what does California buy the most of", "top spending categories for the CA Department of Health Care Services". This is CALIFORNIA STATE data (not federal). |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "ca-procurement": {
      "url": "https://gateway.pipeworx.io/ca-procurement/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/ca-procurement/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Ca Procurement data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/ca_procurement_awards \
  -H 'Content-Type: application/json' \
  -d '{"supplier":"Microsoft","department":"Health Care Services","keyword":"software","fiscal_year":"2014-2015","min_amount":50000,"limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/ca_procurement_awards`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.
