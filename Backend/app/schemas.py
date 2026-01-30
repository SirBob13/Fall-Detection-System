"""
Pydantic schemas for Fall Detection API
"""

from pydantic import BaseModel, Field, validator, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import re

# ==================== Enums ====================

class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"

class AlertSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AlertStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"

class ProviderType(str, Enum):
    GOOGLE = "google"
    APPLE = "apple"
    FACEBOOK = "facebook"

# ==================== Auth Schemas ====================

class LoginRequest(BaseModel):
    email: str = Field(..., description="البريد الإلكتروني")
    password: str = Field(..., min_length=6, description="كلمة المرور")
    device_info: Optional[str] = None
    
    @validator('email')
    def validate_email(cls, v):
        """التحقق من صحة البريد الإلكتروني."""
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, v):
            raise ValueError('بريد إلكتروني غير صالح')
        return v.lower()

class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., description="البريد الإلكتروني")
    phone: Optional[str] = None
    password: str = Field(..., min_length=8)
    confirm_password: str
    age: Optional[int] = Field(None, gt=0, lt=120)
    gender: Optional[Gender] = None
    weight: Optional[float] = Field(None, gt=0)
    height: Optional[float] = Field(None, gt=0)
    medical_conditions: Optional[str] = None
    emergency_contact: Optional[str] = None
    
    @validator('email')
    def validate_email(cls, v):
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, v):
            raise ValueError('بريد إلكتروني غير صالح')
        return v.lower()
    
    @validator('confirm_password')
    def passwords_match(cls, v, values, **kwargs):
        if 'password' in values and v != values['password']:
            raise ValueError('كلمتا المرور غير متطابقتين')
        return v
    
    @validator('phone')
    def validate_phone(cls, v):
        if v:
            phone_regex = r'^\+?[1-9]\d{1,14}$'
            if not re.match(phone_regex, v):
                raise ValueError('رقم هاتف غير صالح')
        return v

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, Any]

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., description="البريد الإلكتروني")
    
    @validator('email')
    def validate_email(cls, v):
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, v):
            raise ValueError('بريد إلكتروني غير صالح')
        return v.lower()

class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(..., min_length=8)
    confirm_password: str
    
    @validator('confirm_password')
    def passwords_match(cls, v, values, **kwargs):
        if 'password' in values and v != values['password']:
            raise ValueError('كلمتا المرور غير متطابقتين')
        return v

class SocialLoginRequest(BaseModel):
    provider: ProviderType
    token: str
    user_info: Dict[str, Any]

class VerifyEmailRequest(BaseModel):
    token: str = Field(..., description="رمز التحقق")

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)
    confirm_password: str
    
    @validator('confirm_password')
    def passwords_match(cls, v, values, **kwargs):
        if 'new_password' in values and v != values['new_password']:
            raise ValueError('كلمتا المرور غير متطابقتين')
        return v

class UserProfileResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str]
    age: Optional[int]
    gender: Optional[Gender]
    weight: Optional[float]
    height: Optional[float]
    medical_conditions: Optional[str]
    emergency_contact: Optional[str]
    is_active: bool
    email_verified: bool
    phone_verified: bool
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[Gender] = None
    weight: Optional[float] = None
    height: Optional[float] = None
    medical_conditions: Optional[str] = None
    emergency_contact: Optional[str] = None

class AccountStatusResponse(BaseModel):
    exists: bool
    email_verified: bool
    phone_verified: bool
    is_active: bool
    has_password: bool
    social_accounts: List[Dict[str, Any]]

class UserSessionResponse(BaseModel):
    id: str
    device_info: Optional[str]
    ip_address: Optional[str]
    created_at: datetime
    expires_at: datetime
    
    class Config:
        from_attributes = True

# ==================== User Schemas ====================

class UserBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    age: int = Field(..., gt=0, lt=120)
    gender: Gender
    weight: Optional[float] = Field(None, gt=0)
    height: Optional[float] = Field(None, gt=0)
    medical_conditions: Optional[str] = None
    emergency_contact: Optional[str] = None

class UserCreate(UserBase):
    email: str
    phone: str

class UserResponse(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True

# ==================== Device Schemas ====================

class DeviceBase(BaseModel):
    device_id: str
    mac_address: Optional[str] = None
    firmware_version: Optional[str] = None
    battery_level: Optional[float] = Field(None, ge=0, le=100)

class DeviceCreate(DeviceBase):
    user_id: int

class DeviceResponse(DeviceBase):
    id: int
    user_id: int
    is_connected: bool
    last_seen: datetime
    created_at: datetime
    
    class Config:
        from_attributes = True

class DeviceUpdate(BaseModel):
    battery_level: Optional[float] = None
    is_connected: Optional[bool] = None
    firmware_version: Optional[str] = None

# ==================== Motion Sensor Schemas ====================

class MotionDataBase(BaseModel):
    device_id: str
    acc_x: float
    acc_y: float
    acc_z: float
    gyro_x: float
    gyro_y: float
    gyro_z: float
    temperature: Optional[float] = None

class MotionDataCreate(MotionDataBase):
    user_id: int

class MotionDataResponse(MotionDataBase):
    id: int
    user_id: int
    acc_mag: float
    gyro_mag: float
    is_fall_suspected: bool
    timestamp: datetime
    
    class Config:
        from_attributes = True

class BatchMotionData(BaseModel):
    user_id: int
    device_id: str
    data: List[MotionDataBase]

# ==================== Vital Signs Schemas ====================

class VitalDataBase(BaseModel):
    heart_rate: Optional[float] = Field(None, gt=0, lt=300)
    blood_pressure_systolic: Optional[float] = Field(None, gt=0, lt=300)
    blood_pressure_diastolic: Optional[float] = Field(None, gt=0, lt=200)
    oxygen_saturation: Optional[float] = Field(None, ge=0, le=100)
    body_temperature: Optional[float] = Field(None, gt=20, lt=45)
    respiration_rate: Optional[float] = Field(None, gt=0, lt=100)

class VitalDataCreate(VitalDataBase):
    user_id: int

class VitalDataResponse(VitalDataBase):
    id: int
    user_id: int
    is_abnormal: bool
    abnormality_type: Optional[str]
    timestamp: datetime
    
    class Config:
        from_attributes = True

class BatchVitalData(BaseModel):
    user_id: int
    data: List[VitalDataBase]

# ==================== Prediction Schemas ====================

class PredictionBase(BaseModel):
    fall_now_probability: float = Field(..., ge=0, le=1)
    fall_soon_probability: float = Field(..., ge=0, le=1)
    fall_now_prediction: bool
    fall_soon_prediction: bool

class PredictionCreate(PredictionBase):
    user_id: int
    motion_data_id: int
    vital_check_performed: bool = False
    vital_check_result: Optional[bool] = None
    final_verdict: Optional[bool] = None
    confidence_score: Optional[float] = None

class PredictionResponse(PredictionBase):
    id: int
    user_id: int
    motion_data_id: int
    vital_check_performed: bool
    vital_check_result: Optional[bool]
    final_verdict: Optional[bool]
    confidence_score: Optional[float]
    timestamp: datetime
    
    class Config:
        from_attributes = True

# ==================== Alert Schemas ====================

class AlertBase(BaseModel):
    alert_type: str
    severity: AlertSeverity
    message: str

class AlertCreate(AlertBase):
    user_id: int
    prediction_id: Optional[int] = None

class AlertResponse(AlertBase):
    id: int
    user_id: int
    prediction_id: Optional[int]
    status: AlertStatus
    sent_to: Optional[str]
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[datetime]
    resolved_at: Optional[datetime]
    timestamp: datetime
    
    class Config:
        from_attributes = True

class AlertUpdate(BaseModel):
    status: Optional[AlertStatus] = None
    acknowledged_by: Optional[str] = None

# ==================== Emergency Schemas ====================

class EmergencyContactBase(BaseModel):
    name: str
    phone: str
    relationship: str
    priority: int = Field(ge=1, le=3)
    is_active: bool = True

class EmergencyContactCreate(EmergencyContactBase):
    user_id: int

class EmergencyContactResponse(EmergencyContactBase):
    id: int
    user_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class EmergencySettings(BaseModel):
    auto_call_emergency: bool = True
    send_sms: bool = True
    send_location: bool = True
    call_after_fall: bool = True
    sos_countdown: int = Field(default=5, ge=3, le=30)
    max_retries: int = Field(default=3, ge=1, le=5)

class EmergencyTrigger(BaseModel):
    user_id: int
    type: str
    location: Optional[Dict[str, Any]] = None
    fall_data: Optional[Dict[str, Any]] = None

class EmergencyResponse(BaseModel):
    success: bool
    message: str
    timestamp: datetime
    emergency_id: str

# ==================== System Schemas ====================

class HealthCheck(BaseModel):
    status: str
    timestamp: datetime
    database: str
    model_loaded: bool
    uptime: float

class SystemStats(BaseModel):
    users: Dict[str, int]
    predictions: Dict[str, int]
    alerts: Dict[str, int]
    timestamp: datetime

class APIResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class PaginationParams(BaseModel):
    skip: int = 0
    limit: int = 100

class SearchParams(BaseModel):
    query: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

# ==================== Test Schemas ====================

class TestMotionData(BaseModel):
    user_id: int = 1
    device_id: str = "TEST_DEVICE"
    acc_x: float = 0.1
    acc_y: float = 0.2
    acc_z: float = 9.8
    gyro_x: float = 5.0
    gyro_y: float = -3.0
    gyro_z: float = 2.0
    temperature: float = 36.5

class TestVitalData(BaseModel):
    user_id: int = 1
    heart_rate: float = 75.0
    blood_pressure_systolic: float = 120.0
    blood_pressure_diastolic: float = 80.0
    oxygen_saturation: float = 98.0
    body_temperature: float = 36.6
    respiration_rate: float = 16.0

# ==================== Validation Schemas ====================

class ValidationError(BaseModel):
    field: str
    message: str
    type: str

class ErrorResponse(BaseModel):
    detail: str
    errors: Optional[List[ValidationError]] = None