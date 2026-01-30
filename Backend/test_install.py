# Backend/test_install.py

try:
    import fastapi
    import uvicorn
    import pydantic
    import sqlalchemy
    import pysqlite3
    import numpy
    import pandas
    import sklearn
    import joblib
    
    print("✅ All packages installed successfully!")
    print(f"FastAPI: {fastapi.__version__}")
    print(f"SQLAlchemy: {sqlalchemy.__version__}")
    print(f"Pydantic: {pydantic.__version__}")
    print(f"NumPy: {numpy.__version__}")
    print(f"Pandas: {pandas.__version__}")
    
except ImportError as e:
    print(f"❌ Missing package: {e}")