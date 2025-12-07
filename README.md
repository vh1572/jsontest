# Index constituents exporter

This repository contains a Python script to export S&P 500 and S&P MidCap 400 constituents (ticker, name, sector) with a recent closing price and dividend yield into a CSV file.

## Prerequisites
- Python 3.9+
- Internet access (to read Wikipedia and query Yahoo Finance)

Install dependencies:

```bash
pip install -r requirements.txt
```

## Usage
Run the script directly to generate `index_constituents.csv` in the current directory:

```bash
python fetch_indices.py
```

To save to a custom path, pass `--output` (or `-o`):

```bash
python fetch_indices.py --output /path/to/constituents.csv
```

The script will print the number of rows written when it finishes.

## Notes
- Prices and dividend yields are fetched via Yahoo Finance and may occasionally be missing for certain symbols.
- The download may take a few minutes depending on network conditions.
