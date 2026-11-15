"""Beyond Earth Labs science service: NASA data ingestion, terrain analysis, deep learning."""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
MODELS_DIR = REPO_ROOT / "models"
EXPERIMENTS_DIR = REPO_ROOT / "experiments"

__version__ = "0.1.0"
