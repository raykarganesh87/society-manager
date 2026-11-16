PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS societies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, reg_no TEXT, address TEXT, city TEXT, state TEXT, pin TEXT,
  reg_date TEXT, email TEXT, phone TEXT,
  chairman TEXT, secretary TEXT, treasurer TEXT, bank_details TEXT,
  fy_start_month INTEGER NOT NULL DEFAULT 4,
  due_day INTEGER NOT NULL DEFAULT 15,
  penalty_method TEXT NOT NULL DEFAULT 'fixed' CHECK (penalty_method IN ('fixed','percent','per_day','monthly_interest')),
  penalty_rate REAL NOT NULL DEFAULT 0,
  penalty_grace_days INTEGER NOT NULL DEFAULT 0,
  penalty_max_paise INTEGER,
  penalty_effective_from TEXT NOT NULL DEFAULT '2000-01-01',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('society_admin','chairman','secretary','treasurer','accountant','security')),
  pin_hash TEXT NOT NULL, pin_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS flats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id),
  building TEXT NOT NULL DEFAULT '', floor_no INTEGER, flat_no TEXT NOT NULL,
  flat_type TEXT, carpet_area REAL,
  owner_name TEXT NOT NULL, co_owner TEXT, mobile TEXT, whatsapp TEXT, email TEXT,
  permanent_address TEXT, ownership_date TEXT,
  tenant_name TEXT, tenant_mobile TEXT,
  occupancy TEXT NOT NULL DEFAULT 'owner' CHECK (occupancy IN ('owner','tenant','vacant')),
  vehicle TEXT, parking_slot TEXT, member_reg_no TEXT,
  monthly_maintenance_paise INTEGER NOT NULL DEFAULT 0,
  penalty_exempt INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (society_id, building, flat_no)
);

CREATE TABLE IF NOT EXISTS ownership_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flat_id INTEGER NOT NULL REFERENCES flats(id),
  owner_name TEXT NOT NULL, from_date TEXT, to_date TEXT, note TEXT
);

-- One bill per flat per month. Penalty is stored on the bill, so it can never be charged twice.
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id),
  flat_id INTEGER NOT NULL REFERENCES flats(id),
  year INTEGER NOT NULL, month INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  maintenance_paise INTEGER NOT NULL,
  extra_paise INTEGER NOT NULL DEFAULT 0,
  previous_balance_paise INTEGER NOT NULL DEFAULT 0,
  penalty_paise INTEGER NOT NULL DEFAULT 0,
  penalty_detail TEXT,
  penalty_waived_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (flat_id, year, month)
);

-- Payments are never deleted or edited. A mistake is fixed with a reversal row.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id),
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  receipt_no TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise <> 0),
  mode TEXT NOT NULL CHECK (mode IN ('cash','cheque','upi','neft_rtgs','bank_transfer','card','other')),
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','pending_verification')),
  penalty_part_paise INTEGER NOT NULL DEFAULT 0,
  reverses_payment_id INTEGER REFERENCES payments(id),
  note TEXT, entered_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (society_id, receipt_no)
);
-- Blocks the same UPI/bank/cheque reference being entered twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_reference ON payments (society_id, reference)
  WHERE reference IS NOT NULL AND reference <> '' AND reverses_payment_id IS NULL;
-- A payment can be reversed only once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_reversal ON payments (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, society_id INTEGER NOT NULL REFERENCES societies(id),
  name TEXT NOT NULL, phone TEXT, service TEXT
);

CREATE TABLE IF NOT EXISTS income_expense (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES societies(id),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  txn_date TEXT NOT NULL, voucher_no TEXT, category TEXT NOT NULL, description TEXT,
  vendor_id INTEGER REFERENCES vendors(id), invoice_no TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise <> 0),
  mode TEXT, reference TEXT,
  approval TEXT NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending','approved','rejected')),
  approved_by TEXT,
  reverses_id INTEGER REFERENCES income_expense(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT
);

CREATE INDEX IF NOT EXISTS ix_bills_flat ON bills (flat_id, year, month);
CREATE INDEX IF NOT EXISTS ix_payments_bill ON payments (bill_id);
CREATE INDEX IF NOT EXISTS ix_flats_search ON flats (society_id, flat_no, owner_name, mobile);

-- Payments and ledger rows cannot be changed or deleted once written.
CREATE TRIGGER IF NOT EXISTS payments_no_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'Payments cannot be edited. Add a reversal entry instead.'); END;
CREATE TRIGGER IF NOT EXISTS payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'Payments cannot be deleted. Add a reversal entry instead.'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON income_expense
BEGIN SELECT RAISE(ABORT, 'Ledger entries cannot be deleted. Add a reversal entry instead.'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit log is read-only.'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit log is read-only.'); END;

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- Expense / ledger protections (added in version 1.1)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ie_voucher ON income_expense (society_id, voucher_no) WHERE voucher_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ie_reversal ON income_expense (reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ie_date ON income_expense (society_id, kind, txn_date);
-- Only the approval status may change on a ledger row. Amount, date, category and so on are fixed once saved.
CREATE TRIGGER IF NOT EXISTS ledger_fixed_fields BEFORE UPDATE OF kind, txn_date, voucher_no, category, description, vendor_id, invoice_no, amount_paise, mode, reference, reverses_id ON income_expense
BEGIN SELECT RAISE(ABORT, 'Expense details cannot be edited. Reverse the entry and add a new one.'); END;
