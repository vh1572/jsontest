"""
Script to download S&P 500 and S&P MidCap 400 constituents, add recent closing
prices and dividend yields, and save to CSV.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Dict, Iterable, List

import pandas as pd
import yfinance as yf


@dataclass
class Constituent:
    symbol: str
    name: str
    sector: str
    price: float | None
    dividend_yield: float | None

    @classmethod
    def from_row(
        cls, row: pd.Series, price_lookup: Dict[str, float | None], yield_lookup: Dict[str, float | None]
    ) -> "Constituent":
        symbol = row["Symbol"].strip()
        return cls(
            symbol=symbol,
            name=row.get("Security") or row.get("Company") or row.get("Name"),
            sector=row.get("GICS Sector") or row.get("Sector"),
            price=price_lookup.get(symbol),
            dividend_yield=yield_lookup.get(symbol),
        )


def fetch_constituents(url: str) -> pd.DataFrame:
    """Fetches index constituents from the first table on a Wikipedia page."""
    tables = pd.read_html(url)
    for table in tables:
        if "Symbol" in table.columns:
            return table
    raise ValueError(f"No table with a Symbol column found at {url}")


def fetch_prices(symbols: Iterable[str]) -> Dict[str, float | None]:
    """Get recent closing prices for the provided symbols."""
    tickers = list(symbols)
    if not tickers:
        return {}

    download = yf.download(tickers, period="5d", progress=False, group_by="ticker")
    prices: Dict[str, float | None] = {}

    if download.empty:
        return {ticker: None for ticker in tickers}

    if isinstance(download.columns, pd.MultiIndex):
        # Multiple tickers returned.
        for ticker in tickers:
            try:
                prices[ticker] = float(download.loc[:, (ticker, "Close")].dropna().iloc[-1])
            except Exception:
                prices[ticker] = None
    else:
        # Single ticker returned.
        prices[tickers[0]] = float(download["Close"].dropna().iloc[-1])

    return prices


def fetch_dividend_yields(symbols: Iterable[str]) -> Dict[str, float | None]:
    """Retrieve dividend yields using Yahoo Finance data.

    Uses Ticker.info dividendYield field, falling back to trailingAnnualDividendYield.
    Returned values are percentages.
    """
    yields: Dict[str, float | None] = {}
    for symbol in symbols:
        try:
            info = yf.Ticker(symbol).info
        except Exception:
            yields[symbol] = None
            continue

        raw_yield = info.get("dividendYield")
        if raw_yield is None:
            raw_yield = info.get("trailingAnnualDividendYield")

        yields[symbol] = float(raw_yield * 100) if raw_yield is not None else None

    return yields


def build_constituents() -> List[Constituent]:
    sp500_url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    midcap_url = "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"

    sp500_df = fetch_constituents(sp500_url)
    midcap_df = fetch_constituents(midcap_url)

    combined_df = pd.concat([sp500_df, midcap_df], ignore_index=True)
    combined_df["Symbol"] = combined_df["Symbol"].astype(str)

    symbols = combined_df["Symbol"].tolist()
    prices = fetch_prices(symbols)
    dividend_yields = fetch_dividend_yields(symbols)

    return [Constituent.from_row(row, prices, dividend_yields) for _, row in combined_df.iterrows()]


def write_csv(constituents: Iterable[Constituent], output_path: str) -> None:
    data = [
        {
            "Symbol": c.symbol,
            "Name": c.name,
            "Sector": c.sector,
            "Price": c.price,
            "Dividend Yield": c.dividend_yield,
        }
        for c in constituents
    ]
    df = pd.DataFrame(data, columns=["Symbol", "Name", "Sector", "Price", "Dividend Yield"])
    df.to_csv(output_path, index=False)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export S&P 500 and S&P MidCap 400 constituents to CSV")
    parser.add_argument(
        "-o",
        "--output",
        default="index_constituents.csv",
        help="Path to write the CSV file (default: index_constituents.csv)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    constituents = build_constituents()
    write_csv(constituents, args.output)
    print(f"Wrote {len(constituents)} rows to {args.output}")


if __name__ == "__main__":
    main()
