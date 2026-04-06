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
    """Main users table"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Personal Information
    name = Column(String(100), nullable=False, index=True)
    phone = Column(String(20))  # User phone number
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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships with proper cascade
    auth = relationship("UserAuth", back_populates="user", uselist=False, 
                       cascade="all, delete-orphan", single_parent=True)
    
    devices = relationship("Device", back_populates="user", 
                          cascade="all, delete-orphan")
    
    motions = relationship("MotionSensorData", back_populates="user", 
                          cascade="all, delete-orphan")
    
    vitals = relationship("VitalSensorData", back_populates="user", 
                         cascade="all, delete-orphan")
    
    predictions = relationship("Prediction", back_populates="user", 
                              cascade="all, delete-orphan")
    
    alerts = relationship("Alert", back_populates="user", 
                         cascade="all, delete-orphan")
    
    emergency_contacts = relationship("EmergencyContact", back_populates="user_relation", 
                                     cascade="all, delete-orphan")
    
    social_accounts = relationship("SocialAccount", back_populates="user", 
                                  cascade="all, delete-orphan")
    
    sessions = relationship("UserSession", back_populates="user", 
                           cascade="all, delete-orphan")

    push_tokens = relationship("UserPushToken", back_populates="user",
                              cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_user_active', 'is_active'),
        Index('idx_user_created', 'created_at'),
        Index('idx_user_phone', 'phone'),
    )
    
    def __repr__(self):
        return f"<User(id={self.id}, name='{self.name}', email='{self.auth.email if self.auth else 'No Auth'}')>"

class UserAuth(Base):
    """User authentication table"""
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
    """User sessions table"""
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
    """Social media accounts table"""
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


class UserPushToken(Base):
    """Push notification tokens for user devices"""
    __tablename__ = "user_push_tokens"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(255), nullable=False)
    platform = Column(String(20), default="unknown")
    device_id = Column(String(100))
    is_active = Column(Boolean, default=True)
    last_seen = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="push_tokens")

    __table_args__ = (
        UniqueConstraint('user_id', 'token', name='uq_user_push_token'),
        Index('idx_push_user', 'user_id'),
        Index('idx_push_token', 'token'),
    )

    def __repr__(self):
        return f"<UserPushToken(id={self.id}, user_id={self.user_id}, platform='{self.platform}')>"

# ==================== Caregiver Links ====================

class CareLink(Base):
    """Links between caregivers and monitored users"""
    __tablename__ = "care_links"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    caregiver_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Use attribute name different from "relationship" to avoid clashing with SQLAlchemy function
    relationship_type = Column("relationship", String(50))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    caregiver = relationship(
        "User",
        foreign_keys=[caregiver_id],
        backref=backref("care_links_as_caregiver", cascade="all, delete-orphan")
    )
    patient = relationship(
        "User",
        foreign_keys=[patient_id],
        backref=backref("care_links_as_patient", cascade="all, delete-orphan")
    )

    __table_args__ = (
        UniqueConstraint('caregiver_id', 'patient_id', name='uq_caregiver_patient'),
        Index('idx_care_caregiver', 'caregiver_id'),
        Index('idx_care_patient', 'patient_id'),
    )

    def __repr__(self):
        return f"<CareLink(id={self.id}, caregiver_id={self.caregiver_id}, patient_id={self.patient_id})>"

# ==================== Caregiver Link Requests ====================

class CareLinkRequest(Base):
    """Caregiver to patient link requests (requires patient approval)."""
    __tablename__ = "care_link_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    caregiver_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    relationship_type = Column(String(50))
    message = Column(String(255))
    status = Column(String(20), default="pending", index=True)  # pending/accepted/rejected/cancelled

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    responded_at = Column(DateTime)

    caregiver = relationship(
        "User",
        foreign_keys=[caregiver_id],
        backref=backref("care_requests_sent", cascade="all, delete-orphan"),
    )
    patient = relationship(
        "User",
        foreign_keys=[patient_id],
        backref=backref("care_requests_received", cascade="all, delete-orphan"),
    )

    __table_args__ = (
        Index("idx_care_request_status", "status"),
        Index("idx_care_request_caregiver", "caregiver_id"),
        Index("idx_care_request_patient", "patient_id"),
    )

    def __repr__(self):
        return (
            f"<CareLinkRequest(id={self.id}, caregiver_id={self.caregiver_id}, "
            f"patient_id={self.patient_id}, status={self.status})>"
        )

# ==================== Device Models ====================

class Device(Base):
    """Devices table"""
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
    is_archived = Column(Boolean, default=False, nullable=False)
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
    """Motion sensor data table"""
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
    
    # Indexes - UPDATED VERSION
    __table_args__ = (
        # New composite indexes for frequent queries
        Index('idx_motion_user_device_time', 'user_id', 'device_id', 'timestamp'),
        Index('idx_motion_fall_suspected_time', 'is_fall_suspected', 'timestamp'),
        
        # Single column indexes for sensor data filtering
        Index('idx_motion_acc_x', 'acc_x'),
        Index('idx_motion_acc_y', 'acc_y'),
        Index('idx_motion_acc_z', 'acc_z'),
        Index('idx_motion_gyro_x', 'gyro_x'),
        Index('idx_motion_gyro_y', 'gyro_y'),
        Index('idx_motion_gyro_z', 'gyro_z'),
        Index('idx_motion_temperature', 'temperature'),
        
        # Keep existing indexes
        Index('idx_motion_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_motion_device_timestamp', 'device_id', 'timestamp'),
        Index('idx_motion_fall_suspected', 'is_fall_suspected'),
        Index('idx_motion_acc_mag', 'acc_mag'),
        Index('idx_motion_gyro_mag', 'gyro_mag'),
    )
    
    def __repr__(self):
        return f"<MotionSensorData(id={self.id}, user_id={self.user_id}, timestamp={self.timestamp})>"

class VitalSensorData(Base):
    """Vital signs sensor data table"""
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
    
    # Indexes - UPDATED VERSION
    __table_args__ = (
        # New composite index for frequent queries
        Index('idx_vital_user_abnormal_time', 'user_id', 'is_abnormal', 'timestamp'),
        
        # Indexes for specific vital signs
        Index('idx_vital_bp_systolic', 'blood_pressure_systolic'),
        Index('idx_vital_bp_diastolic', 'blood_pressure_diastolic'),
        Index('idx_vital_respiration', 'respiration_rate'),
        Index('idx_vital_hrv', 'heart_rate_variability'),
        
        # Keep existing indexes
        Index('idx_vital_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_vital_abnormal', 'is_abnormal'),
        Index('idx_vital_heart_rate', 'heart_rate'),
        Index('idx_vital_oxygen', 'oxygen_saturation'),
    )
    
    def __repr__(self):
        return f"<VitalSensorData(id={self.id}, user_id={self.user_id}, timestamp={self.timestamp})>"

# ==================== AI Prediction Models ====================

class Prediction(Base):
    """System predictions table"""
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
        Index('idx_prediction_vital_check', 'vital_check_performed'),
    )
    
    def __repr__(self):
        return f"<Prediction(id={self.id}, user_id={self.user_id}, fall_now={self.fall_now_prediction})>"

# ==================== Alert Models ====================

class Alert(Base):
    """Alerts table"""
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
        Index('idx_alert_prediction', 'prediction_id'),
    )
    
    def __repr__(self):
        return f"<Alert(id={self.id}, user_id={self.user_id}, type='{self.alert_type}', status='{self.status}')>"

# ==================== Emergency Models ====================

class EmergencyContact(Base):
    """Emergency contacts table"""
    __tablename__ = "emergency_contacts"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Contact Information
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=False)
    relation_type = Column(String(50))  # family, friend, doctor, neighbor
    priority = Column(Integer, default=3)
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship with User
    user_relation = relationship("User", back_populates="emergency_contacts")
    
    # Indexes
    __table_args__ = (
        Index('idx_contact_user_priority', 'user_id', 'priority'),
        Index('idx_contact_active', 'is_active'),
        Index('idx_contact_relation', 'relation_type'),
    )
    
    def __repr__(self):
        return f"<EmergencyContact(id={self.id}, name='{self.name}', user_id={self.user_id})>"

class EmergencyLog(Base):
    """Emergency operations log table"""
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
        Index('idx_emergencylog_location', 'location_lat', 'location_lng'),
    )
    
    def __repr__(self):
        return f"<EmergencyLog(id={self.id}, user_id={self.user_id}, type='{self.emergency_type}')>"

# ==================== System Models ====================

class SystemLog(Base):
    """System logs table"""
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
        Index('idx_systemlog_device', 'device_id'),
    )
    
    def __repr__(self):
        return f"<SystemLog(id={self.id}, level='{self.level}', source='{self.source}')>"

class SystemSetting(Base):
    """System settings table"""
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
        Index('idx_setting_data_type', 'data_type'),
    )
    
    def __repr__(self):
        return f"<SystemSetting(id={self.id}, key='{self.key}', category='{self.category}')>"

# ==================== Utility Models ====================

class DatabaseMigration(Base):
    """Database migrations tracking table"""
    __tablename__ = "database_migrations"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Migration Info
    migration_name = Column(String(200), unique=True, nullable=False)
    version = Column(String(50), nullable=False)
    
    # Status
    applied_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    status = Column(String(20), default='success')  # 'success', 'failed', 'pending'
    error_message = Column(Text)
    
    # Indexes
    __table_args__ = (
        Index('idx_migration_version', 'version'),
        Index('idx_migration_status', 'status'),
        Index('idx_migration_applied_at', 'applied_at'),
    )
    
    def __repr__(self):
        return f"<DatabaseMigration(id={self.id}, migration_name='{self.migration_name}', status='{self.status}')>"
