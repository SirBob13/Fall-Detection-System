# في وحدة Python تفاعلية أو في script منفصل
from app.database import engine, Base
from app import models  # ⬅️ هذا مهم لتحميل جميع النماذج

# إنشاء الجداول
Base.metadata.create_all(bind=engine)
print("✅ Database tables created successfully")