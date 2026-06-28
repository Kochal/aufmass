"""Idempotent dev seed: tenants, users, and nummernkreis for the dev stack.

Fixed UUIDs survive restarts. Runs as the migrate superuser after migrations
complete (ENV=dev only). ON CONFLICT DO NOTHING makes it safe to re-run.

Use these values for the dev header-stub auth:
  T1: X-Tenant-Id: 11111111-0000-0000-0000-000000000001
      X-User-Id:   11111111-0000-0000-0000-000000000002
  T2: X-Tenant-Id: 22222222-0000-0000-0000-000000000001
      X-User-Id:   22222222-0000-0000-0000-000000000002
"""
from __future__ import annotations

import os

import psycopg

T1_ID = "11111111-0000-0000-0000-000000000001"
T1_USER_ID = "11111111-0000-0000-0000-000000000002"
T2_ID = "22222222-0000-0000-0000-000000000001"
T2_USER_ID = "22222222-0000-0000-0000-000000000002"

# Fixed UUIDs for the dev leistungskatalog (T1) so tests can reference them.
T1_KATALOG_ID = "11111111-0000-0000-0000-000000000010"
T1_LEISTUNG_STREICHEN_ID = "11111111-0000-0000-0000-000000000011"
T1_LEISTUNG_VERLEGEN_ID = "11111111-0000-0000-0000-000000000012"

# Fixed UUIDs for the T1 e-invoice master data.
T1_ADRESSE_SELLER_ID = "11111111-0000-0000-0000-000000000020"
T1_BANKVERBINDUNG_ID = "11111111-0000-0000-0000-000000000021"
T1_BILLING_PROFILE_ID = "11111111-0000-0000-0000-000000000022"
# Demo buyer — a public client with address + Leitweg-ID for e2e XRechnung tests.
T1_ADRESSE_AG_ID = "11111111-0000-0000-0000-000000000030"
T1_AG_OEFFENTLICH_ID = "11111111-0000-0000-0000-000000000031"

_DATABASE_URL = os.environ.get("DATABASE_URL", "")


def run() -> None:
    if not _DATABASE_URL:
        print("migrate: seed skipped (DATABASE_URL not set)")
        return
    with psycopg.connect(_DATABASE_URL, autocommit=False) as conn:
        # Set actor for audit triggers (session-level, not transaction-local).
        conn.execute("select set_config('app.user_id', 'dev-seed', false)")

        # Tenants (tenant.id IS the tenant scope, so no tenant_id column).
        conn.execute(
            "insert into tenant(id, name) values (%s, %s) on conflict do nothing",
            (T1_ID, "Maler Müller GmbH (dev T1)"),
        )
        conn.execute(
            "insert into tenant(id, name) values (%s, %s) on conflict do nothing",
            (T2_ID, "Boden Schmidt KG (dev T2)"),
        )

        # App users.
        conn.execute(
            "insert into app_user(id, tenant_id, email, display_name, role) "
            "values (%s,%s,%s,%s,'inhaber') on conflict do nothing",
            (T1_USER_ID, T1_ID, "admin@mueller-maler.de", "Admin T1"),
        )
        conn.execute(
            "insert into app_user(id, tenant_id, email, display_name, role) "
            "values (%s,%s,%s,%s,'inhaber') on conflict do nothing",
            (T2_USER_ID, T2_ID, "admin@schmidt-boden.de", "Admin T2"),
        )

        # Nummernkreis for projekt, angebot, rechnung (unique on tenant_id, doc_type).
        for tid in (T1_ID, T2_ID):
            conn.execute(
                "insert into nummernkreis(tenant_id, doc_type, format, reset_policy) "
                "values (%s, 'projekt', 'P-{YYYY}-{SEQ:4}', 'none') "
                "on conflict (tenant_id, doc_type) do nothing",
                (tid,),
            )
            conn.execute(
                "insert into nummernkreis(tenant_id, doc_type, format, reset_policy) "
                "values (%s, 'angebot', 'A-{YYYY}-{SEQ:4}', 'none') "
                "on conflict (tenant_id, doc_type) do nothing",
                (tid,),
            )
            conn.execute(
                "insert into nummernkreis(tenant_id, doc_type, format, reset_policy) "
                "values (%s, 'rechnung', 'RE-{YYYY}-{SEQ:5}', 'yearly') "
                "on conflict (tenant_id, doc_type) do nothing",
                (tid,),
            )

        # Per-tenant tax profiles (regelbesteuert, 19 % — the standard case).
        # T1 gets a dev-placeholder USt-ID so EN 16931 BT-31 is satisfied.
        conn.execute(
            "insert into tenant_tax_profile(tenant_id, kleinunternehmer, ust_treatment, ust_satz, ust_idnr) "
            "values (%s, false, 'regelbesteuert', 19.00, 'DE123456789') "
            "on conflict (tenant_id) do update set ust_idnr = 'DE123456789'",
            (T1_ID,),
        )
        conn.execute(
            "insert into tenant_tax_profile(tenant_id, kleinunternehmer, ust_treatment, ust_satz) "
            "values (%s, false, 'regelbesteuert', 19.00) "
            "on conflict (tenant_id) do nothing",
            (T2_ID,),
        )

        # Dev leistungskatalog and two leistungen for T1 (tests reference the fixed IDs).
        conn.execute(
            "insert into leistungskatalog(id, tenant_id, name, aktiv) "
            "values (%s, %s, 'Hauptkatalog', true) on conflict do nothing",
            (T1_KATALOG_ID, T1_ID),
        )
        conn.execute(
            "insert into leistung(id, tenant_id, leistungskatalog_id, code, kurztext, "
            "einheit, einheitspreis, aktiv) "
            "values (%s,%s,%s,'STREICH-01','Wandfläche streichen','m2',8.50,true) "
            "on conflict do nothing",
            (T1_LEISTUNG_STREICHEN_ID, T1_ID, T1_KATALOG_ID),
        )
        conn.execute(
            "insert into leistung(id, tenant_id, leistungskatalog_id, code, kurztext, "
            "einheit, einheitspreis, aktiv) "
            "values (%s,%s,%s,'BODEN-01','Laminat verlegen','m2',22.00,true) "
            "on conflict do nothing",
            (T1_LEISTUNG_VERLEGEN_ID, T1_ID, T1_KATALOG_ID),
        )

        # ── T1 e-invoice master data ──────────────────────────────────────────
        # Seller address (must be inserted BEFORE billing profile refs it).
        conn.execute(
            "insert into adresse(id, tenant_id, strasse, plz, ort, land) "
            "values (%s,%s,'Musterstraße 1','80331','München','DE') on conflict do nothing",
            (T1_ADRESSE_SELLER_ID, T1_ID),
        )
        # Seller bank account (SEPA credit transfer, BG-16).
        conn.execute(
            "insert into bankverbindung(id, tenant_id, iban, bic, inhaber, bank_name) "
            "values (%s,%s,'DE89370400440532013000','COBADEFFXXX',"
            "'Maler Müller GmbH','Commerzbank') on conflict do nothing",
            (T1_BANKVERBINDUNG_ID, T1_ID),
        )
        # Seller billing profile (1:1 with tenant; elektronische_adresse = BT-34).
        # BR-DE-6 requires BT-42 (kontakt_tel) — XRechnung German CIUS mandatory.
        conn.execute(
            "insert into tenant_billing_profile("
            "  id, tenant_id, adresse_id, bankverbindung_id,"
            "  elektronische_adresse, eas_scheme,"
            "  kontakt_name, kontakt_tel, kontakt_email, zahlungsziel_tage"
            ") values (%s,%s,%s,%s,'rechnungen@mueller-maler.de','EM',"
            "  'Admin T1','+49 89 000000','admin@mueller-maler.de',30)"
            " on conflict (id) do update set kontakt_tel = '+49 89 000000'",
            (T1_BILLING_PROFILE_ID, T1_ID, T1_ADRESSE_SELLER_ID, T1_BANKVERBINDUNG_ID),
        )
        # Demo public buyer with Leitweg-ID — for XRechnung e2e tests.
        conn.execute(
            "insert into adresse(id, tenant_id, strasse, plz, ort, land) "
            "values (%s,%s,'Karl-Scharnagl-Ring 3','80539','München','DE') on conflict do nothing",
            (T1_ADRESSE_AG_ID, T1_ID),
        )
        conn.execute(
            "insert into auftraggeber(id, tenant_id, name, typ, adresse_id, leitweg_id, "
            "  elektronische_adresse, eas_scheme) "
            "values (%s,%s,'Stadtwerke München GmbH','oeffentlich',%s,'991-12345678-06',"
            "  'eingang@stadtwerke-muenchen.de','EM') on conflict do nothing",
            (T1_AG_OEFFENTLICH_ID, T1_ID, T1_ADRESSE_AG_ID),
        )

        conn.commit()

    print("migrate: dev seed applied")
    print(f"  T1: X-Tenant-Id: {T1_ID}  X-User-Id: {T1_USER_ID}")
    print(f"  T2: X-Tenant-Id: {T2_ID}  X-User-Id: {T2_USER_ID}")
