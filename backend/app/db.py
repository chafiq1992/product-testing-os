from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# For MVP we skip DB persistence; wire this later if needed
# engine = create_engine("postgresql+psycopg://user:pass@host:5432/dbname", future=True)
# SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
