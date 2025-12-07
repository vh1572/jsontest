import fs from 'node:fs/promises';
import process from 'node:process';
import * as cheerio from 'cheerio';
import yahooFinance from 'yahoo-finance2';
import { stringify } from 'csv-stringify/sync';

const SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const MIDCAP_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_400_companies';
const COLUMN_ORDER = ['Symbol', 'Name', 'Sector', 'Price', 'Dividend Yield'];

function parseArgs() {
  const args = process.argv.slice(2);
  let output = 'index_constituents.csv';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '-o' || arg === '--output') && i + 1 < args.length) {
      output = args[i + 1];
      i += 1;
    }
  }

  return { output };
}

async function fetchHtml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseConstituentTable(html) {
  const $ = cheerio.load(html);
  const tables = $('table');

  for (const table of tables.toArray()) {
    const headerCells = $(table)
      .find('tr')
      .first()
      .find('th, td');
    const headers = headerCells
      .map((_, cell) => $(cell).text().trim())
      .toArray();

    const symbolIndex = headers.findIndex((header) => header.toLowerCase() === 'symbol');
    if (symbolIndex === -1) {
      continue;
    }

    const rows = $(table)
      .find('tr')
      .slice(1)
      .map((_, row) => {
        const entry = {};

        $(row)
          .find('th, td')
          .toArray()
          .forEach((cell, cellIndex) => {
            const header = headers[cellIndex] ?? `column_${cellIndex}`;
            entry[header] = $(cell).text().trim();
          });

        return entry[headers[symbolIndex]] ? entry : null;
      })
      .toArray()
      .filter(Boolean);

    if (rows.length) {
      return rows;
    }
  }

  throw new Error('No table with a Symbol column was found in the provided HTML');
}

async function fetchConstituents(url) {
  const html = await fetchHtml(url);
  return parseConstituentTable(html);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toYahooSymbol(symbol) {
  return symbol.replace(/\./g, '-');
}

async function fetchQuoteData(symbols) {
  if (!symbols.length) return {};

  const results = {};
  const chunks = chunkArray(symbols, 50);

  for (const chunk of chunks) {
    const yahooSymbols = chunk.map(toYahooSymbol);
    const symbolMap = new Map(yahooSymbols.map((value, index) => [value, chunk[index]]));

    try {
      const quotes = await yahooFinance.quote(yahooSymbols, {
        fields: ['symbol', 'regularMarketPrice', 'dividendYield', 'trailingAnnualDividendYield'],
      });
      const quoteArray = Array.isArray(quotes) ? quotes : [quotes];

      for (const quote of quoteArray) {
        if (!quote) continue;
        const originalSymbol = symbolMap.get(quote.symbol) ?? quote.symbol;
        const rawYield =
          typeof quote.dividendYield === 'number'
            ? quote.dividendYield
            : quote.trailingAnnualDividendYield;

        results[originalSymbol] = {
          price: typeof quote.regularMarketPrice === 'number' ? quote.regularMarketPrice : null,
          dividendYield: typeof rawYield === 'number' ? rawYield * 100 : null,
        };
      }
    } catch (error) {
      console.error(`Failed to fetch quotes for chunk starting with ${chunk[0]}:`, error.message);
    }

    for (const symbol of chunk) {
      if (!results[symbol]) {
        results[symbol] = { price: null, dividendYield: null };
      }
    }
  }

  return results;
}

async function buildConstituents() {
  const [sp500Rows, midcapRows] = await Promise.all([
    fetchConstituents(SP500_URL),
    fetchConstituents(MIDCAP_URL),
  ]);

  const combinedRows = [...sp500Rows, ...midcapRows];
  const symbols = combinedRows.map((row) => String(row.Symbol).trim());
  const quoteData = await fetchQuoteData(symbols);

  return combinedRows.map((row) => {
    const symbol = String(row.Symbol).trim();
    const name = row.Security ?? row.Company ?? row.Name ?? '';
    const sector = row['GICS Sector'] ?? row.Sector ?? '';
    const pricing = quoteData[symbol] ?? { price: null, dividendYield: null };

    return {
      symbol,
      name,
      sector,
      price: pricing.price,
      dividendYield: pricing.dividendYield,
    };
  });
}

async function writeCsv(constituents, outputPath) {
  const rows = constituents.map((c) => ({
    Symbol: c.symbol,
    Name: c.name,
    Sector: c.sector,
    Price: c.price,
    'Dividend Yield': c.dividendYield,
  }));

  const csv = stringify(rows, { header: true, columns: COLUMN_ORDER });
  await fs.writeFile(outputPath, csv, 'utf8');
}

async function main() {
  const { output } = parseArgs();
  const constituents = await buildConstituents();
  await writeCsv(constituents, output);
  console.log(`Wrote ${constituents.length} rows to ${output}`);
}

main().catch((error) => {
  console.error('Failed to build constituents:', error);
  process.exitCode = 1;
});
