"""
SQLAlchemy models for Fall Detection Database
"""

from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean, 
    Text, ForeignKey, UniqueConstraint, Index, DECIMAL
)
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from datetime import datetime
import uuid

from .database import Base

# ==================== User Models ====================

class User(Base):
    """جدول المستخدمين الرئيسي"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Personal Information
    name = Column(String(100), nullable=False, index=True)
    age = Column(Integer)
    gender = Column(String(10))  # male, female, other
    weight = Column(Float)  # kg
    height = Column(Float)  # cm
    medical_conditions = Column(Text)
    emergency_contact = Column(String(20))
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)  # إضافة هذا السطر
    
    # Relationships
    auth = relationship("UserAuth", back_populates="user", uselist=False, cascade="all, delete-orphan")
    devices = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    motions = relationship("MotionSensorData", back_populates="user", cascade="all, delete-orphan")
    vitals = relationship("VitalSensorData", back_populates="user", cascade="all, delete-orphan")
    predictions = relationship("Prediction", back_populates="user", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="user", cascade="all, delete-orphan")
    emergency_contacts = relationship("EmergencyContact", back_populates="user_relation", cascade="all, delete-orphan")  # ✅ هنا التغيير
    social_accounts = relationship("SocialAccount", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_user_active', 'is_active'),
        Index('idx_user_created', 'created_at'),
    )
    
    def __repr__(self):
        return f"<User(id={self.id}, name='{self.name}', email='{self.auth.email if self.auth else 'No Auth'}')>"



class UserAuth(Base):
    """جدول مصادقة المستخدمين"""
    __tablename__ = "user_auth"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    
    # Authentication
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255))  # Nullable for social login users
    
    # Verification
    email_verified = Column(Boolean, default=False)
    phone_verified = Column(Boolean, default=False)
    verification_token = Column(String(100))
    reset_token = Column(String(100))
    reset_token_expiry = Column(DateTime)
    
    # Security
    login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime)
    last_login = Column(DateTime)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="auth")
    
    # Indexes
    __table_args__ = (
        Index('idx_userauth_email', 'email'),
        Index('idx_userauth_verified', 'email_verified'),
    )
    
    def __repr__(self):
        return f"<UserAuth(id={self.id}, email='{self.email}', user_id={self.user_id})>"

class UserSession(Base):
    """جدول جلسات المستخدمين"""
    __tablename__ = "user_sessions"
    
    id = Column(String(100), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Session Data
    token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=False)
    device_info = Column(Text)
    ip_address = Column(String(45))
    
    # Expiry
    expires_at = Column(DateTime, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="sessions")
    
    # Indexes
    __table_args__ = (
        Index('idx_session_token', 'token'),
        Index('idx_session_expires', 'expires_at'),
        Index('idx_session_user', 'user_id', 'created_at'),
    )
    
    def __repr__(self):
        return f"<UserSession(id={self.id}, user_id={self.user_id}, expires_at={self.expires_at})>"

class SocialAccount(Base):
    """جدول حسابات التواصل الاجتماعي"""
    __tablename__ = "social_accounts"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Provider Info
    provider = Column(String(50), nullable=False)  # google, apple, facebook
    provider_user_id = Column(String(255), nullable=False)
    
    # User Info from Provider
    email = Column(String(255))
    display_name = Column(String(255))
    photo_url = Column(Text)
    
    # Tokens
    access_token = Column(Text)
    refresh_token = Column(Text)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="social_accounts")
    
    # Constraints
    __table_args__ = (
        UniqueConstraint('provider', 'provider_user_id', name='uq_provider_user'),
        Index('idx_social_user', 'user_id'),
        Index('idx_social_provider', 'provider'),
    )
    
    def __repr__(self):
        return f"<SocialAccount(id={self.id}, provider='{self.provider}', user_id={self.user_id})>"

# ==================== Device Models ====================

class Device(Base):
    """جدول الأجهزة"""
    __tablename__ = "devices"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Device Identification
    device_id = Column(String(50), unique=True, nullable=False)
    mac_address = Column(String(17))
    firmware_version = Column(String(20))
    
    # Status
    battery_level = Column(Float)  # 0-100
    is_connected = Column(Boolean, default=False)
    last_seen = Column(DateTime, default=datetime.utcnow)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="devices")
    motions = relationship("MotionSensorData", back_populates="device", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_device_user', 'user_id'),
        Index('idx_device_connected', 'is_connected'),
        Index('idx_device_last_seen', 'last_seen'),
    )
    
    def __repr__(self):
        return f"<Device(id={self.id}, device_id='{self.device_id}', user_id={self.user_id})>"

# ==================== Sensor Data Models ====================

class MotionSensorData(Base):
    """جدول بيانات مستشعر الحركة"""
    __tablename__ = "motion_sensor_data"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(String(50), ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False)
    
    # Accelerometer Data
    acc_x = Column(Float, nullable=False)
    acc_y = Column(Float, nullable=False)
    acc_z = Column(Float, nullable=False)
    acc_mag = Column(Float, nullable=False)  # Calculated magnitude
    
    # Gyroscope Data
    gyro_x = Column(Float, nullable=False)
    gyro_y = Column(Float, nullable=False)
    gyro_z = Column(Float, nullable=False)
    gyro_mag = Column(Float, nullable=False)  # Calculated magnitude
    
    # Additional Data
    temperature = Column(Float)
    is_fall_suspected = Column(Boolean, default=False)
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Relationships
    user = relationship("User", back_populates="motions")
    device = relationship("Device", back_populates="motions")
    predictions = relationship("Prediction", back_populates="motion_data", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_motion_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_motion_device_timestamp', 'device_id', 'timestamp'),
        Index('idx_motion_fall_suspected', 'is_fall_suspected'),
        Index('idx_motion_acc_mag', 'acc_mag'),
        Index('idx_motion_gyro_mag', 'gyro_mag'),
    )
    
    def __repr__(self):
        return f"<MotionSensorData(id={self.id}, user_id={self.user_id}, timestamp={self.timestamp})>"

class VitalSensorData(Base):
    """جدول بيانات المؤشرات الحيوية"""
    __tablename__ = "vital_sensor_data"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Vital Signs
    heart_rate = Column(Float)  # BPM
    blood_pressure_systolic = Column(Float)  # mmHg
    blood_pressure_diastolic = Column(Float)  # mmHg
    oxygen_saturation = Column(Float)  # SpO2 %
    body_temperature = Column(Float)  # Celsius
    respiration_rate = Column(Float)  # Breaths per minute
    
    # Calculated Metrics
    heart_rate_variability = Column(Float)
    is_abnormal = Column(Boolean, default=False)
    abnormality_type = Column(String(50))
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Relationships
    user = relationship("User", back_populates="vitals")
    
    # Indexes
    __table_args__ = (
        Index('idx_vital_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_vital_abnormal', 'is_abnormal'),
        Index('idx_vital_heart_rate', 'heart_rate'),
        Index('idx_vital_oxygen', 'oxygen_saturation'),
    )
    
    def __repr__(self):
        return f"<VitalSensorData(id={self.id}, user_id={self.user_id}, timestamp={self.timestamp})>"

# ==================== AI Prediction Models ====================

class Prediction(Base):
    """جدول تنبؤات النظام"""
    __tablename__ = "predictions"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    motion_data_id = Column(Integer, ForeignKey("motion_sensor_data.id", ondelete="CASCADE"), nullable=False)
    
    # Predictions
    fall_now_probability = Column(Float, nullable=False)  # 0-1
    fall_soon_probability = Column(Float, nullable=False)  # 0-1
    fall_now_prediction = Column(Boolean, nullable=False)
    fall_soon_prediction = Column(Boolean, nullable=False)
    
    # Double Verification
    vital_check_performed = Column(Boolean, default=False)
    vital_check_result = Column(Boolean)
    final_verdict = Column(Boolean)
    confidence_score = Column(Float)  # 0-1
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Relationships
    user = relationship("User", back_populates="predictions")
    motion_data = relationship("MotionSensorData", back_populates="predictions")
    alerts = relationship("Alert", back_populates="prediction", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_prediction_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_prediction_fall_now', 'fall_now_prediction'),
        Index('idx_prediction_fall_soon', 'fall_soon_prediction'),
        Index('idx_prediction_confidence', 'confidence_score'),
        Index('idx_prediction_verdict', 'final_verdict'),
    )
    
    def __repr__(self):
        return f"<Prediction(id={self.id}, user_id={self.user_id}, fall_now={self.fall_now_prediction})>"

# ==================== Alert Models ====================

class Alert(Base):
    """جدول الإنذارات"""
    __tablename__ = "alerts"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    prediction_id = Column(Integer, ForeignKey("predictions.id", ondelete="CASCADE"))
    
    # Alert Details
    alert_type = Column(String(50), nullable=False)  # 'fall', 'vital_abnormal', 'device_offline'
    severity = Column(String(20), nullable=False)  # 'low', 'medium', 'high', 'critical'
    message = Column(Text, nullable=False)
    
    # Status
    status = Column(String(20), default='pending', nullable=False)  # 'pending', 'sent', 'acknowledged', 'resolved'
    sent_to = Column(Text)  # Comma-separated contacts
    acknowledged_by = Column(String(100))
    acknowledged_at = Column(DateTime)
    resolved_at = Column(DateTime)
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Relationships
    user = relationship("User", back_populates="alerts")
    prediction = relationship("Prediction", back_populates="alerts")
    
    # Indexes
    __table_args__ = (
        Index('idx_alert_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_alert_status', 'status'),
        Index('idx_alert_severity', 'severity'),
        Index('idx_alert_type', 'alert_type'),
    )
    
    def __repr__(self):
        return f"<Alert(id={self.id}, user_id={self.user_id}, type='{self.alert_type}', status='{self.status}')>"

# ==================== Emergency Models ====================

class EmergencyContact(Base):
    __tablename__ = "emergency_contacts"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Contact Information
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=False)
    relation_type = Column(String(50))  # family, friend, doctor, neighbor ✅
    priority = Column(Integer, default=3)
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship with User
    user_relation = relationship("User", back_populates="emergency_contacts")


        
class EmergencyLog(Base):
    """جدول سجل عمليات الطوارئ"""
    __tablename__ = "emergency_logs"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Emergency Details
    emergency_type = Column(String(50), nullable=False)  # 'fall', 'manual', 'vital_abnormal'
    location_lat = Column(Float)
    location_lng = Column(Float)
    location_accuracy = Column(Float)
    
    # Message
    message = Column(Text, nullable=False)
    sent_to = Column(Text)  # JSON array of contacts
    
    # Status
    status = Column(String(20), default='pending', nullable=False)  # 'pending', 'sent', 'failed'
    responses = Column(Text)  # JSON array of responses
    
    # Timestamps
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Indexes
    __table_args__ = (
        Index('idx_emergencylog_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_emergencylog_type', 'emergency_type'),
        Index('idx_emergencylog_status', 'status'),
    )
    
    def __repr__(self):
        return f"<EmergencyLog(id={self.id}, user_id={self.user_id}, type='{self.emergency_type}')>"

# ==================== System Models ====================

class SystemLog(Base):
    """جدول سجلات النظام"""
    __tablename__ = "system_logs"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Log Details
    level = Column(String(20), nullable=False)  # 'info', 'warning', 'error', 'critical'
    source = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    details = Column(Text)
    
    # Context
    user_id = Column(Integer, nullable=True)
    device_id = Column(String(50), nullable=True)
    ip_address = Column(String(45))
    
    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Indexes
    __table_args__ = (
        Index('idx_systemlog_timestamp', 'timestamp'),
        Index('idx_systemlog_level', 'level'),
        Index('idx_systemlog_source', 'source'),
        Index('idx_systemlog_user', 'user_id'),
    )
    
    def __repr__(self):
        return f"<SystemLog(id={self.id}, level='{self.level}', source='{self.source}')>"

class SystemSetting(Base):
    """جدول إعدادات النظام"""
    __tablename__ = "system_settings"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Setting
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False)
    category = Column(String(50), default='general')
    description = Column(Text)
    
    # Metadata
    is_editable = Column(Boolean, default=True)
    data_type = Column(String(20), default='string')  # string, number, boolean, json
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Indexes
    __table_args__ = (
        Index('idx_setting_category', 'category'),
        Index('idx_setting_editable', 'is_editable'),
    )
    
    def __repr__(self):
        return f"<SystemSetting(id={self.id}, key='{self.key}', category='{self.category}')>"

# ==================== Utility Models ====================

class DatabaseMigration(Base):
    """جدول تتبع هجرات قاعدة البيانات"""
    __tablename__ = "database_migrations"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Migration Info
    migration_name = Column(String(200), unique=True, nullable=False)
    version = Column(String(50), nullable=False)
    
    # Status
    applied_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    status = Column(String(20), default='success')  #