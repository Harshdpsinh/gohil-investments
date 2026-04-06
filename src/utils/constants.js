// src/utils/constants.js
// Single source of truth — previously duplicated in PoliciesPage, RenewalsPage, ProposalsPage

// FIX #7: centralise company details – import COMPANY in every openWhatsApp instead of copy-pasting
export const COMPANY = {
  name:     'Gohil Investments',
  phones:   ['7698997894', '9426204547'],
  location: 'Bhavnagar, Gujarat',
}

export const KNOWN_INSURERS = [
  // Health
  'Star Health & Allied Insurance', 'New India Assurance', 'ICICI Lombard',
  'HDFC ERGO', 'Bajaj Allianz', 'Niva Bupa (Max Bupa)', 'Care Health Insurance',
  'Aditya Birla Health Insurance', 'Tata AIG', 'Oriental Insurance',
  'United India Insurance', 'National Insurance', 'ManipalCigna Health Insurance',
  'Reliance Health Insurance', 'SBI Health Insurance',
  // Life
  'LIC of India', 'HDFC Life', 'ICICI Prudential Life', 'SBI Life',
  'Max Life Insurance', 'Bajaj Allianz Life', 'Kotak Life Insurance',
  'Tata AIA Life', 'Aditya Birla Sun Life', 'PNB MetLife',
  'Canara HSBC Life', 'Edelweiss Tokio Life', 'IndiaFirst Life',
  // Motor
  'HDFC ERGO Motor', 'New India Assurance Motor', 'Bajaj Allianz Motor',
  'ICICI Lombard Motor', 'Reliance General Insurance', 'Tata AIG Motor',
  'Royal Sundaram', 'Shriram General Insurance', 'Digit Insurance',
  'Kotak Mahindra General Insurance', 'Zuno General Insurance',
  // General
  'Tata AIG General Insurance', 'Bajaj Allianz General Insurance',
  'ICICI Lombard General Insurance', 'SBI General Insurance',
]
