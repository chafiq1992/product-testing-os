# Ensure .env variables are loaded when running locally (outside Docker).
from pathlib import Path
from dotenv import load_dotenv

# Look for .env in project root (two levels up from this file).
root_env = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=root_env, override=False)

# empty on purpose
