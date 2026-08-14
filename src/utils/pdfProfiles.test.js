import { describe, it, expect } from 'vitest'
import {
  parseStatementLines, parseAdityaBirla, parseStarHealth,
  parseIciciLombard, parseTataAia, parseGeneric, parseBandedTable,
} from './pdfProfiles'

// These fixtures are hand-built page captures, not real statements — the real
// files hold client data and cannot live in the repo. Each one reproduces the
// geometry the matching parser actually depends on (Aditya Birla's absolute
// x-bands, Star Health's rotated y-offsets, the aggregator's nearest-header
// assignment), so a carrier changing its template — or someone "tidying" a
// coordinate — fails here instead of silently posting garbage.
const line = (y, cells) => ({ y, cells })
const at = (x, text) => ({ x, text })

// ── Aditya Birla: one record wrapped over three stacked lines ────────────
const ADITYA_BIRLA = [[
  line(700, [at(30, 'Annexure 1 : Policies Issued')]),
  // Only three of these headers are recognised, which is why the banded
  // parser declines this page and the ABH profile gets it.
  line(650, [at(30, 'Policy No'), at(70, 'Insured'), at(150, 'Product'),
    at(260, 'Premium'), at(360, 'Commission'), at(510, 'Final Amount')]),
  line(600, [at(30, '31-26-'), at(70, 'JATIN')]),
  line(596, [at(150, 'ACTIV ONE MAX')]),
  line(592, [at(30, '0164666-'), at(70, 'BELADIYA'), at(115, 'Retail New Business'),
    at(260, '41,626'), at(320, '32'), at(360, '13,320.32'), at(510, '11,988.29')]),
  line(584, [at(30, '00')]),
  // Totals must never post as a policy.
  line(500, [at(30, 'Total'), at(360, '13,320.32'), at(510, '11,988.29')]),
]]

describe('parseAdityaBirla', () => {
  it('rejoins a policy number split across three lines', () => {
    expect(parseAdityaBirla(ADITYA_BIRLA)[0].policyNumber).toBe('31-26-0164666-00')
  })

  it('reads the money columns from their x-bands', () => {
    const [row] = parseAdityaBirla(ADITYA_BIRLA)
    expect(row).toMatchObject({
      clientName: 'JATIN BELADIYA',
      insurer: 'Aditya Birla Health Insurance',
      planName: 'ACTIV ONE MAX',
      premium: 41626,
      commissionPct: 32,
      commissionAmount: 13320.32,
      // 'Fresh', not 'New' — the same word the spreadsheet path and the
      // Commission page filter use. 'New' never matched the "Fresh" filter.
      businessType: 'Fresh',
    })
  })

  it('skips the totals line', () => {
    expect(parseAdityaBirla(ADITYA_BIRLA)).toHaveLength(1)
  })

  // Aditya Birla prints reward lines in the same column as the business type.
  // The parser used to pass the band text straight through, so the ledger ended
  // up with "Booster" filed as if it were a kind of business.
  it('does not treat a Booster reward line as a business type', () => {
    const withBooster = [[
      ADITYA_BIRLA[0][0], ADITYA_BIRLA[0][1],
      line(600, [at(30, '31-26-'), at(70, 'JATIN')]),
      line(596, [at(150, 'ACTIV ONE MAX')]),
      line(592, [at(30, '0164666-'), at(70, 'BELADIYA'), at(115, 'Booster'),
        at(260, '41,626'), at(320, '5'), at(360, '2,300.00'), at(510, '2,070.00')]),
      line(584, [at(30, '00')]),
    ]]
    expect(parseAdityaBirla(withBooster)[0].businessType).toBe('')
  })

  it('ignores a page without the annexure heading', () => {
    const [page] = ADITYA_BIRLA
    expect(parseAdityaBirla([page.slice(1)])).toEqual([])
  })
})

// ── Star Health: the table is rotated 90°, policies are x-columns ────────
const STAR_HEALTH = [[
  line(760, [at(200, 'STAR HEALTH AND ALLIED INSURANCE CO LTD')]),
  line(700, [at(310, 'Policy No'), at(400, '1234567890'), at(450, '9876543210')]),
  line(658, [at(400, 'JATIN'), at(450, 'RAJU')]),
  line(650, [at(310, "Proposer's")]),
  line(625, [at(400, '41,626'), at(450, '10,000')]),
  line(600, [at(310, 'Premium/Ref')]),
  line(565, [at(400, '5,000'), at(450, '1,200')]),
  line(560, [at(310, 'Payable')]),
]]

describe('parseStarHealth', () => {
  it('reads each policy out of its own column', () => {
    expect(parseStarHealth(STAR_HEALTH)).toEqual([
      {
        policyNumber: '1234567890', clientName: 'JATIN',
        insurer: 'Star Health & Allied Insurance',
        premium: 41626, commissionPct: 12.01, commissionAmount: 5000, businessType: '',
      },
      {
        policyNumber: '9876543210', clientName: 'RAJU',
        insurer: 'Star Health & Allied Insurance',
        premium: 10000, commissionPct: 12, commissionAmount: 1200, businessType: '',
      },
    ])
  })

  it('yields nothing when the label column moves out of its x-band', () => {
    const shifted = STAR_HEALTH[0].map(l => line(l.y, l.cells.map(c =>
      c.x === 310 ? at(280, c.text) : c)))
    expect(parseStarHealth([shifted])).toEqual([])
  })
})

// ── ICICI Lombard: ordinary single-line header table ────────────────────
const ICICI = [[
  line(700, [
    at(20, 'Intermediary Name'), at(90, 'IRDA Code'), at(140, 'MO Name'),
    at(190, 'Insured Name'), at(260, 'System Policy No'), at(340, 'GWP'),
    at(380, '%TDS'), at(420, 'Gross Amt'), at(480, 'TDS'), at(520, 'Net Amt'),
    at(580, 'Renewed Policy'),
  ]),
  line(680, [
    at(20, 'UMABA GOHIL'), at(90, 'IRDA123'), at(140, 'MO1'),
    at(190, 'ANKUSH JAIN'), at(260, '4128i/12345678/00'), at(340, '25000'),
    at(380, '5'), at(420, '2500'), at(480, '125'), at(520, '2375'),
    at(580, 'Renewal'),
  ]),
  // A genuine reversal must survive.
  line(660, [
    at(20, 'UMABA GOHIL'), at(90, 'IRDA123'), at(140, 'MO1'),
    at(190, 'SITA DEVI'), at(260, '4128i/99999999/00'), at(340, '10000'),
    at(380, '5'), at(420, '-1000'), at(480, '0'), at(520, '-1000'),
    at(580, 'New'),
  ]),
  line(600, [
    at(20, 'Grand Total'), at(90, ''), at(140, ''), at(190, ''), at(260, ''),
    at(340, '35000'), at(380, ''), at(420, '1500'), at(480, '125'), at(520, '1375'),
  ]),
]]

describe('parseIciciLombard', () => {
  it('maps the row by header position', () => {
    expect(parseIciciLombard(ICICI)[0]).toEqual({
      policyNumber: '4128i/12345678/00', clientName: 'ANKUSH JAIN',
      insurer: 'ICICI Lombard', premium: 25000,
      commissionAmount: 2500, commissionPct: 10, businessType: 'Renewal',
    })
  })

  it('keeps negative reversals instead of dropping them', () => {
    expect(parseIciciLombard(ICICI)[1].commissionAmount).toBe(-1000)
  })

  it('skips the grand total', () => {
    expect(parseIciciLombard(ICICI)).toHaveLength(2)
  })
})

// ── Tata AIA: one long text row under a named section ───────────────────
const TATA = [[
  line(700, [at(20, 'Cycle Wise Earning Breakup')]),
  line(680, [
    at(20, '15/06/2026'), at(80, 'U1234567'), at(140, 'RAMESH PATEL'),
    at(220, 'Inforce'), at(260, '10'), at(290, '10'), at(330, '50,000'),
    at(390, '3.5%'), at(430, '0.00'), at(470, '1,750.00'),
  ]),
]]

describe('parseTataAia', () => {
  it('pulls the credit column as the commission', () => {
    expect(parseTataAia(TATA)).toEqual([{
      policyNumber: 'U1234567', clientName: 'RAMESH PATEL', insurer: 'Tata AIA',
      premium: 50000, commissionPct: 3.5, commissionAmount: 1750, businessType: 'New',
    }])
  })

  it('ignores the same row outside the earning-breakup section', () => {
    expect(parseTataAia([TATA[0].slice(1)])).toEqual([])
  })
})

// ── Broker / aggregator bill: nearest-header assignment ─────────────────
// Reproduces the verified WealthMaker row. "Policy Issue Dt." is deliberately
// unrecognised: it must act as a sink, or its date leaks into Policy No.
const AGGREGATOR = [[
  line(650, [at(100, 'Transaction Detailed Report')]),
  line(600, [
    at(100, 'Policy No.'), at(200, 'Investor'), at(300, 'Company /'),
    at(400, 'Plan/Scheme'), at(480, 'Policy Issue Dt.'), at(560, 'Premium'),
    at(640, 'Payout'), at(700, 'Fresh/'),
  ]),
  line(590, [at(300, 'AMC'), at(700, 'Renewal')]),
  line(560, [
    at(95, '7330289382'), at(190, 'BELADIYA JATIN'), at(290, 'TATA AIG GENERAL'),
    at(395, 'MEDICARE SELECT'), at(475, '21/06/2026'), at(555, '41,626'),
    at(635, '13,320.32'), at(695, 'Renewal'),
  ]),
  line(548, [at(190, 'BABUBHAI'), at(290, 'INSURANCE CO.LTD.')]),
  line(500, [at(95, 'Grand'), at(130, 'Total'), at(635, '13,320.32')]),
]]

describe('parseBandedTable', () => {
  it('reads the verified aggregator row, wrapped cells and all', () => {
    expect(parseBandedTable(AGGREGATOR)).toEqual([{
      policyNumber: '7330289382',
      clientName: 'BELADIYA JATIN BABUBHAI',
      insurer: 'TATA AIG GENERAL INSURANCE CO.LTD.',
      planName: 'MEDICARE SELECT',
      premium: 41626,
      commissionPct: 0,
      commissionAmount: 13320.32,
      businessType: 'Renewal',
    }])
  })

  it('does not leak the issue date into the policy number', () => {
    expect(parseBandedTable(AGGREGATOR)[0].policyNumber).not.toMatch(/2026/)
  })

  it('declines a table whose header names no commission column', () => {
    const noPayout = AGGREGATOR[0].map(l => line(l.y, l.cells.map(c =>
      c.text === 'Payout' ? at(c.x, 'TDS') : c)))
    expect(parseBandedTable([noPayout])).toEqual([])
  })

  // A "%" header is a rate whatever it is called — without this rule Niva
  // Bupa's "Payout %" posts 12.71 instead of 3504.
  it('treats a percent header as the rate, not the amount', () => {
    const withRate = AGGREGATOR[0].map(l => line(l.y, l.cells.map(c =>
      c.text === 'Policy Issue Dt.' ? at(c.x, 'Payout %') : c)))
    const rows = parseBandedTable([withRate.map(l => line(l.y, l.cells.map(c =>
      c.text === '21/06/2026' ? at(c.x, '32') : c)))])
    expect(rows[0]).toMatchObject({ commissionPct: 32, commissionAmount: 13320.32 })
  })
})

describe('parseGeneric', () => {
  it('handles a plain header/value table', () => {
    expect(parseGeneric([[
      line(700, [at(20, 'Policy Number'), at(120, 'Customer Name'), at(220, 'Premium'), at(300, 'Commission Amount')]),
      line(680, [at(20, 'P123456'), at(120, 'SITA DEVI'), at(220, '20000'), at(300, '1500')]),
      line(660, [at(20, 'Total'), at(120, ''), at(220, '20000'), at(300, '1500')]),
    ]])).toEqual([{
      policyNumber: 'P123456', clientName: 'SITA DEVI', insurer: '',
      premium: 20000, commissionAmount: 1500, commissionPct: 7.5, businessType: '',
    }])
  })
})

describe('parseStatementLines', () => {
  it('labels each layout with the profile that claimed it', () => {
    expect(parseStatementLines(AGGREGATOR).format).toBe('broker / aggregator bill')
    expect(parseStatementLines(ADITYA_BIRLA).format).toBe('Aditya Birla Health')
    expect(parseStatementLines(STAR_HEALTH).format).toBe('Star Health')
    expect(parseStatementLines(ICICI).format).toBe('ICICI Lombard')
    expect(parseStatementLines(TATA).format).toBe('Tata AIA')
  })

  it('numbers the rows so postingKey can tell duplicates apart', () => {
    expect(parseStatementLines(STAR_HEALTH).rows.map(r => r.sourceRow)).toEqual([1, 2])
  })

  it('reports a totals-only PDF as unrecognised rather than failing', () => {
    expect(parseStatementLines([[line(700, [at(20, 'Statement of Account')])]]))
      .toEqual({ format: 'unrecognised', rows: [] })
  })
})
