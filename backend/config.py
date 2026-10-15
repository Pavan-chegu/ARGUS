import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    FALKORDB_HOST: str = os.getenv("FALKORDB_HOST", "localhost")
    FALKORDB_PORT: int = int(os.getenv("FALKORDB_PORT", "6379"))
    FALKORDB_USERNAME: str | None = os.getenv("FALKORDB_USERNAME", None)
    FALKORDB_PASSWORD: str | None = os.getenv("FALKORDB_PASSWORD", None)
    GRAPH_NAME: str = os.getenv("GRAPH_NAME", "ArgusCloud")
    

settings = Settings()
