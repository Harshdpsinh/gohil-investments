# SCHEMA REFERENCE — Gohil Investments v3.0
# Firestore Collections + SQLAlchemy equivalents

---

## FIRESTORE COLLECTIONS

### `clients/{clientId}`
```
name             : string
mobile           : string
email            : string
pan              : string
aadhar           : string
dob              : string (YYYY-MM-DD)
gender           : string (Male | Female | Other)
address          : string
city             : string
state            : string
occupation       : string
employment       : string
income           : string
qualification    : string
designation      : string
kycStatus        : string (Pending | In Progress | Complete)
notes            : string
createdAt        : timestamp
updatedAt        : timestamp
```
Subcollection: `clients/{clientId}/documents/{docId}`
```
name      : string
url       : string (Cloudinary secure_url)
publicId  : string
size      : number
type      : string
format    : string
uploadedAt: timestamp
```

---

### `policies/{policyId}`
Base fields (all types):
```
policyNumber     : string
clientId         : string (FK → clients)
clientName       : string (denormalized for display)
policyType       : string (Health | Life | Motor | Home | Travel | ...)
insurer          : string
planName         : string
premium          : string
frequency        : string (Yearly | Half-Yearly | Quarterly | Monthly)
startDate        : string (YYYY-MM-DD)
expiryDate       : string (YYYY-MM-DD)
status           : string (Active | Lapsed | Cancelled | Matured | Renewed-Out)
nominee          : string
nomineeRelation  : string
fyCommission     : string (percentage)
ryCommission     : string (percentage)
notes            : string
policyPdfUrl     : string (Cloudinary URL)
policyPdfName    : string
parentPolicyId   : string | null  ← links to previous year's policy
policyYear       : number (1, 2, 3…)
renewedAt        : timestamp | null
createdAt        : timestamp
updatedAt        : timestamp
```

Health-specific extra fields:
```
sumInsured         : string
cumulativeBonus    : string
cumulativeBonusPct : string
roomRentLimit      : string
coPay              : string
restoreBenefit     : boolean
dateOfFirstEntry   : string (YYYY-MM-DD)
isPortability      : boolean
prevInsurer        : string
prevPolicyNo       : string
portabilityNCB     : string
members            : array of {
  name         : string
  dob          : string
  age          : string
  relationship : string
  ped          : string
}
```

Life-specific extra fields:
```
sumAssured        : string
policySubType     : string (Term | Endowment | ULIP | Money-Back | ...)
ppt               : string (Premium Paying Term in years)
policyTerm        : string
maturityDate      : string (YYYY-MM-DD)
surrenderValue    : string
loanAgainstPolicy : boolean
smoker            : boolean
nomineeName       : string
nomineeRelation   : string
nomineeDob        : string
nomineePan        : string
appointeeName     : string
appointeeRelation : string
```

Motor-specific extra fields:
```
vehicleType       : string (2W | 4W | Commercial | Trailer)
registrationNo    : string
make              : string
model             : string
variant           : string
year              : string
fuelType          : string
engineNo          : string
chassisNo         : string
colour            : string
coverType         : string (Comprehensive | Third Party | OD Only)
idv               : string
ncbPct            : string (0 | 20 | 25 | 35 | 45 | 50)
prevNcbPct        : string
addons            : map {
  zeroDep, engineProtect, rsa, keyReplace,
  consumables, returnToInvoice, tyreProtect, personalAccident
}
isHypothecated    : boolean
hypothecationBank : string
tpPolicyNo        : string
tpInsurer         : string
tpExpiry          : string
```

---

### `claims/{claimId}`
```
clientId        : string (FK → clients)
clientName      : string
policyId        : string (FK → policies)
policyNumber    : string
claimNo         : string (from insurer)
claimType       : string (Cashless | Reimbursement | OD Damage | ...)
incidentDate    : string (YYYY-MM-DD)
intimationDate  : string (YYYY-MM-DD)
claimAmount     : string
settledAmount   : string
status          : string (Intimated | Documents Submitted | Under Review | Approved | Settled | Rejected)
rejectionReason : string
notes           : string
createdAt       : timestamp
updatedAt       : timestamp
```

---

### `tasks/{taskId}`
```
title         : string
type          : string (Call | Email | Meeting | Follow-up | Document Collection | Other)
priority      : string (High | Medium | Low)
dueDate       : string (YYYY-MM-DD)
done          : boolean
clientId      : string (optional FK → clients)
clientName    : string
policyId      : string (optional FK → policies)
policyNumber  : string
notes         : string
createdAt     : timestamp
updatedAt     : timestamp
```

---

### `proposals/{proposalId}`
(existing, unchanged)

### `users/{uid}`
(existing, unchanged)

---

## SQLALCHEMY EQUIVALENT MODELS
(Reference only — for future migration away from Firebase)

```python
from sqlalchemy import Column, String, Boolean, Integer, Float, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime

Base = declarative_base()

class Client(Base):
    __tablename__ = 'clients'
    id            = Column(String, primary_key=True)
    name          = Column(String, nullable=False)
    mobile        = Column(String)
    email         = Column(String)
    pan           = Column(String)
    aadhar        = Column(String)
    dob           = Column(String)
    gender        = Column(String)
    address       = Column(Text)
    city          = Column(String)
    state         = Column(String)
    occupation    = Column(String)
    employment    = Column(String)
    income        = Column(String)
    qualification = Column(String)
    designation   = Column(String)
    kyc_status    = Column(String, default='Pending')
    notes         = Column(Text)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, onupdate=datetime.utcnow)
    policies      = relationship('Policy', back_populates='client')
    claims        = relationship('Claim',  back_populates='client')

class Policy(Base):
    __tablename__ = 'policies'
    id                = Column(String, primary_key=True)
    policy_number     = Column(String, nullable=False, index=True)
    client_id         = Column(String, ForeignKey('clients.id'), nullable=False)
    policy_type       = Column(String)
    insurer           = Column(String)
    plan_name         = Column(String)
    premium           = Column(Float)
    frequency         = Column(String)
    start_date        = Column(String)
    expiry_date       = Column(String)
    status            = Column(String, default='Active')
    nominee           = Column(String)
    nominee_relation  = Column(String)
    fy_commission     = Column(Float)
    ry_commission     = Column(Float)
    policy_pdf_url    = Column(String)
    # Versioning
    parent_policy_id  = Column(String, ForeignKey('policies.id'), nullable=True)
    policy_year       = Column(Integer, default=1)
    renewed_at        = Column(DateTime, nullable=True)
    # Type-specific stored as JSON blobs
    health_data       = Column(JSON)  # sumInsured, members, dateOfFirstEntry etc.
    life_data         = Column(JSON)  # sumAssured, ppt, policyTerm, nominee etc.
    motor_data        = Column(JSON)  # regNo, engineNo, idv, ncb, addons etc.
    notes             = Column(Text)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, onupdate=datetime.utcnow)
    client            = relationship('Client', back_populates='policies')
    children          = relationship('Policy', backref='parent', remote_side=[id])
    claims            = relationship('Claim',  back_populates='policy')

class Claim(Base):
    __tablename__     = 'claims'
    id                = Column(String, primary_key=True)
    client_id         = Column(String, ForeignKey('clients.id'), nullable=False)
    policy_id         = Column(String, ForeignKey('policies.id'))
    claim_no          = Column(String)
    claim_type        = Column(String)
    incident_date     = Column(String)
    intimation_date   = Column(String)
    claim_amount      = Column(Float)
    settled_amount    = Column(Float)
    status            = Column(String, default='Intimated')
    rejection_reason  = Column(Text)
    notes             = Column(Text)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, onupdate=datetime.utcnow)
    client            = relationship('Client', back_populates='claims')
    policy            = relationship('Policy', back_populates='claims')

class Task(Base):
    __tablename__  = 'tasks'
    id             = Column(String, primary_key=True)
    title          = Column(String, nullable=False)
    type           = Column(String)
    priority       = Column(String, default='Medium')
    due_date       = Column(String)
    done           = Column(Boolean, default=False)
    client_id      = Column(String, ForeignKey('clients.id'), nullable=True)
    policy_id      = Column(String, ForeignKey('policies.id'), nullable=True)
    notes          = Column(Text)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, onupdate=datetime.utcnow)
```

---

## FIRESTORE RULES UPDATE
Add these collections to your `firestore.rules`:

```
match /claims/{claimId}    { allow read, write: if isAuth(); }
match /tasks/{taskId}      { allow read, write: if isAuth(); }
```

Full updated rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuth() { return request.auth != null; }
    match /clients/{clientId}    { allow read, write: if isAuth();
      match /documents/{docId}   { allow read, write: if isAuth(); } }
    match /policies/{policyId}   { allow read, write: if isAuth(); }
    match /proposals/{proposalId}{ allow read, write: if isAuth(); }
    match /claims/{claimId}      { allow read, write: if isAuth(); }
    match /tasks/{taskId}        { allow read, write: if isAuth(); }
    match /users/{userId}        { allow read, write: if isAuth(); }
    match /{document=**}         { allow read, write: if false; }
  }
}
```
