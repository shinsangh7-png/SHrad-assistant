from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

settings.db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models_db  # noqa: F401

    Base.metadata.create_all(bind=engine)
