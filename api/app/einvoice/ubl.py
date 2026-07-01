"""XRechnung UBL 2.1 e-invoice builder (EN 16931, XRechnung 3.0 CIUS).

Produces a valid EN 16931 UBL Invoice document using stdlib xml.etree.ElementTree
(no new dependency). The caller supplies already-computed Decimal totals (from
the pricing engine) — no money math happens here.

KEY CONSTRAINT: a model output is a candidate; a deterministic gate commits the
number. By the time this function is called, the Rechnungsnummer is allocated
(core.allocate_number), the totals are committed (berechnen), and the tax
snapshot is set (core.issue_rechnung). This function only serialises.

STEUERBERATER FLAGS embedded as comments:
  - VAT category code for Kleinunternehmer (E vs O per EN 16931)
  - §19 UStG exemption reason code
  - EAS scheme codes for electronic address routing
See notes/quotation/2026-06-28-xrechnung-einvoice.md for the full list.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from .units import map_einheit

# UBL 2.1 namespaces (kept here so register_namespace is called at import time).
_UBL_INV = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"

ET.register_namespace("", _UBL_INV)
ET.register_namespace("cac", _CAC)
ET.register_namespace("cbc", _CBC)

_XRECHNUNG_3 = (
    "urn:cen.eu:en16931:2017"
    "#compliant"
    "#urn:xeinkauf.de:kosit:xrechnung_3.0"
)
# NOTE: The organisation domain changed from xoev-de to xeinkauf.de in XRechnung 3.0
# (2025 validator-configuration releases). The xoev-de URI was used for older versions.
# Our pinned validator-configuration-xrechnung_3.0.2_2025-07-10.zip expects xeinkauf.de.
_PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"

# STEUERBERATER FLAG: category 'E' (Exempt) is used here for Kleinunternehmer.
# EN 16931 also defines 'O' (Not subject to VAT) for national-law exemptions
# such as §19 UStG. The correct code depends on the buyer's receiving system
# and the tax advisor's interpretation. Confirm before first production issue.
_VAT_EXEMPT_REASON_CODE = "VATEX-EU-O"
_VAT_EXEMPT_REASON_TEXT = (
    "Umsatzsteuerbefreiung gemäß § 19 UStG (Kleinunternehmerregelung)"
)

_CENT = Decimal("0.01")


def _q(d: Decimal) -> Decimal:
    return d.quantize(_CENT, rounding=ROUND_HALF_UP)


def _cbc(parent: ET.Element, name: str, text: str, **attribs: str) -> ET.Element:
    """Add a CBC child element.  text MUST be non-empty — EN 16931 forbids empty elements."""
    assert text, f"UBL builder: empty value for cbc:{name} is not allowed by EN 16931"
    el = ET.SubElement(parent, f"{{{_CBC}}}{name}", attribs)
    el.text = text
    return el


def _cbc_if(parent: ET.Element, name: str, text: str | None, **attribs: str) -> ET.Element | None:
    """Add a CBC child element only when text is non-empty (optional elements)."""
    if text:
        return _cbc(parent, name, text, **attribs)
    return None


def _cac(parent: ET.Element, name: str) -> ET.Element:
    return ET.SubElement(parent, f"{{{_CAC}}}{name}")


def _fmt(value: Decimal | None) -> str:
    """Format a Decimal as a two-decimal string (EN 16931 requires fixed decimals)."""
    return f"{Decimal(str(value or '0')):.2f}"


def build_xrechnung(
    rechnung: dict,
    positions: list[dict],
    seller: dict,
    buyer: dict,
    rechnungsnummer: str,
    rechnungsdatum: date,
    faelligkeitsdatum: date,
    leistungsdatum: date | None = None,
) -> bytes:
    """Build an EN 16931 XRechnung 3.0 (UBL 2.1 syntax) and return UTF-8 bytes.

    Parameters
    ----------
    rechnung:       rechnung row (waehrung, summe_netto, summe_brutto, etc.)
    positions:      rechnung_position rows (with gesamtpreis, einheit, etc.)
    seller:         flat dict from _load_seller() JOIN query (tenant + profile + adresse + bank)
    buyer:          flat dict from _load_buyer() JOIN query (auftraggeber + adresse)
    rechnungsnummer: already-allocated BT-1 invoice number
    rechnungsdatum:  BT-2 invoice issue date
    faelligkeitsdatum: BT-9 payment due date
    leistungsdatum:  BT-72 actual delivery date (optional)
    """
    currency = rechnung.get("waehrung") or "EUR"

    # summe_netto stored on rechnung = Σ gesamtpreise (line extension sum, before doc adjustments).
    summe_netto = Decimal(str(rechnung.get("summe_netto") or 0))
    summe_brutto = Decimal(str(rechnung.get("summe_brutto") or 0))
    nachlass = _q(Decimal(str(rechnung.get("nachlass_betrag") or 0)))
    zuschlag = _q(Decimal(str(rechnung.get("zuschlag_betrag") or 0)))

    # EN 16931 BT-109 / BT-116 = taxable amount = line-extension - allowances + charges.
    netto_adj = summe_netto - nachlass + zuschlag
    # BT-117 = tax amount on the adjusted taxable base.
    tax_amount = summe_brutto - netto_adj

    is_klein = bool(seller.get("kleinunternehmer"))
    ust_satz = Decimal(str(seller.get("ust_satz") or 0))
    vat_cat = "E" if is_klein else "S"

    # Line extension amount = sum of gesamtpreise (before doc-level discount/surcharge).
    line_ext = sum(
        Decimal(str(p.get("gesamtpreis") or 0))
        for p in positions
        if p.get("gesamtpreis") is not None
    )

    # ── Root element ──────────────────────────────────────────────────────────
    inv = ET.Element(f"{{{_UBL_INV}}}Invoice")

    # Elements in UBL Invoice 2.1 schema sequence order.
    _cbc(inv, "CustomizationID", _XRECHNUNG_3)      # BT-24
    _cbc(inv, "ProfileID", _PROFILE_ID)              # BT-23
    _cbc(inv, "ID", rechnungsnummer)                 # BT-1
    _cbc(inv, "IssueDate", rechnungsdatum.isoformat())  # BT-2
    _cbc(inv, "DueDate", faelligkeitsdatum.isoformat())  # BT-9
    _cbc(inv, "InvoiceTypeCode", "380")              # BT-3 commercial invoice
    _cbc(inv, "DocumentCurrencyCode", currency)      # BT-5

    # BT-10 BuyerReference: mandatory in XRechnung (BR-DE-15).
    # Use Leitweg-ID if present; fall back to buyer name as routing reference.
    buyer_ref = buyer.get("leitweg_id") or buyer.get("buyer_name")
    if buyer_ref:
        _cbc(inv, "BuyerReference", buyer_ref)

    # NOTE: cac:Delivery (BT-72) must appear AFTER AccountingCustomerParty in
    # the UBL 2.1 XSD sequence.  It is added below, between BG-7 and PaymentMeans.

    # ── BG-4 Seller (AccountingSupplierParty) ──────────────────────────────
    asp = _cac(inv, "AccountingSupplierParty")
    seller_party = _cac(asp, "Party")

    # BT-34 Seller electronic address + BT-34-1 scheme
    seller_endpoint = seller.get("seller_elektronische_adresse")
    if seller_endpoint:
        _cbc(
            seller_party, "EndpointID", seller_endpoint,
            schemeID=seller.get("seller_eas_scheme") or "EM",
        )

    pn = _cac(seller_party, "PartyName")
    _cbc(pn, "Name", seller.get("tenant_name") or "—")  # BT-27

    # BT-35..BT-37 Seller postal address (BG-5)
    pa = _cac(seller_party, "PostalAddress")
    _cbc_if(pa, "StreetName", seller.get("seller_strasse"))          # BT-35
    _cbc_if(pa, "AdditionalStreetName", seller.get("seller_adresszusatz"))
    _cbc_if(pa, "CityName", seller.get("seller_ort"))                # BT-37
    _cbc_if(pa, "PostalZone", seller.get("seller_plz"))              # BT-38
    country = _cac(pa, "Country")
    _cbc(country, "IdentificationCode", seller.get("seller_land") or "DE")  # BT-40

    # BT-31 Seller VAT identifier
    ust_idnr = seller.get("ust_idnr")
    if ust_idnr:
        pts = _cac(seller_party, "PartyTaxScheme")
        _cbc(pts, "CompanyID", ust_idnr)
        ts = _cac(pts, "TaxScheme")
        _cbc(ts, "ID", "VAT")

    # BG-6 Seller legal entity
    ple = _cac(seller_party, "PartyLegalEntity")
    _cbc(ple, "RegistrationName", seller.get("tenant_name") or "—")  # BT-27

    # BG-6 Contact (optional; included when data is present)
    if seller.get("kontakt_name") or seller.get("kontakt_email"):
        contact = _cac(seller_party, "Contact")
        _cbc_if(contact, "Name", seller.get("kontakt_name"))
        _cbc_if(contact, "Telephone", seller.get("kontakt_tel"))
        _cbc_if(contact, "ElectronicMail", seller.get("kontakt_email"))

    # ── BG-7 Buyer (AccountingCustomerParty) ───────────────────────────────
    acp = _cac(inv, "AccountingCustomerParty")
    buyer_party = _cac(acp, "Party")

    # BT-49 Buyer electronic address + BT-49-1 scheme.
    # XRechnung requires an endpoint. Use buyer_elektronische_adresse if set,
    # else fall back to Leitweg-ID (schemeID 0204 = Leitweg-ID Germany).
    buyer_endpoint = buyer.get("buyer_elektronische_adresse")
    buyer_ep_scheme = buyer.get("buyer_eas_scheme") or "EM"
    if not buyer_endpoint and buyer.get("leitweg_id"):
        buyer_endpoint = buyer["leitweg_id"]
        buyer_ep_scheme = "0204"
    if buyer_endpoint:
        _cbc(buyer_party, "EndpointID", buyer_endpoint, schemeID=buyer_ep_scheme)

    bpn = _cac(buyer_party, "PartyName")
    _cbc(bpn, "Name", buyer.get("buyer_name") or "—")  # BT-44

    # BT-50..BT-53 Buyer postal address (BG-8)
    bpa = _cac(buyer_party, "PostalAddress")
    _cbc_if(bpa, "StreetName", buyer.get("buyer_strasse"))
    _cbc_if(bpa, "AdditionalStreetName", buyer.get("buyer_adresszusatz"))
    _cbc_if(bpa, "CityName", buyer.get("buyer_ort"))
    _cbc_if(bpa, "PostalZone", buyer.get("buyer_plz"))
    bcountry = _cac(bpa, "Country")
    _cbc(bcountry, "IdentificationCode", buyer.get("buyer_land") or "DE")  # BT-55

    # BG-8 Buyer legal entity
    bple = _cac(buyer_party, "PartyLegalEntity")
    _cbc(bple, "RegistrationName", buyer.get("buyer_name") or "—")

    # ── cac:Delivery (BT-72 ActualDeliveryDate) ────────────────────────────
    # Must appear AFTER AccountingCustomerParty in the UBL 2.1 XSD sequence.
    if leistungsdatum:
        delivery = _cac(inv, "Delivery")
        _cbc(delivery, "ActualDeliveryDate", leistungsdatum.isoformat())  # BT-72

    # ── BG-16 Payment Means ────────────────────────────────────────────────
    pm = _cac(inv, "PaymentMeans")
    _cbc(pm, "PaymentMeansCode", "58")  # BT-81 SEPA credit transfer
    if seller.get("iban"):
        pfa = _cac(pm, "PayeeFinancialAccount")
        _cbc(pfa, "ID", seller["iban"])  # BT-84 IBAN
        _cbc_if(pfa, "Name", seller.get("bv_inhaber"))
        if seller.get("bic"):
            fib = _cac(pfa, "FinancialInstitutionBranch")
            _cbc(fib, "ID", seller["bic"])

    # ── Document-level AllowanceCharge (BG-20/BG-21) ───────────────────────
    # Must appear BEFORE TaxTotal in UBL 2.1 sequence.
    # BR-CO-12: ChargeTotalAmount (BT-108) = Σ AllowanceCharge.Amount where ChargeIndicator=true.
    # BR-CO-11: AllowanceTotalAmount (BT-107) = Σ AllowanceCharge.Amount where ChargeIndicator=false.
    if nachlass:
        ac_all = _cac(inv, "AllowanceCharge")
        _cbc(ac_all, "ChargeIndicator", "false")                           # mandatory flag
        _cbc(ac_all, "Amount", _fmt(nachlass), currencyID=currency)        # BT-92
        ac_all_tc = _cac(ac_all, "TaxCategory")
        _cbc(ac_all_tc, "ID", vat_cat)
        if not is_klein:
            _cbc(ac_all_tc, "Percent", _fmt(ust_satz))
        ac_all_ts = _cac(ac_all_tc, "TaxScheme")
        _cbc(ac_all_ts, "ID", "VAT")

    if zuschlag:
        ac_chg = _cac(inv, "AllowanceCharge")
        _cbc(ac_chg, "ChargeIndicator", "true")                            # mandatory flag
        _cbc(ac_chg, "Amount", _fmt(zuschlag), currencyID=currency)        # BT-99
        ac_chg_tc = _cac(ac_chg, "TaxCategory")
        _cbc(ac_chg_tc, "ID", vat_cat)
        if not is_klein:
            _cbc(ac_chg_tc, "Percent", _fmt(ust_satz))
        ac_chg_ts = _cac(ac_chg_tc, "TaxScheme")
        _cbc(ac_chg_ts, "ID", "VAT")

    # ── BG-23 VAT breakdown + BG-22 total tax ──────────────────────────────
    tt = _cac(inv, "TaxTotal")
    _cbc(tt, "TaxAmount", _fmt(tax_amount), currencyID=currency)    # BT-110
    tst = _cac(tt, "TaxSubtotal")
    _cbc(tst, "TaxableAmount", _fmt(netto_adj), currencyID=currency) # BT-116 = adjusted net
    _cbc(tst, "TaxAmount", _fmt(tax_amount), currencyID=currency)    # BT-117
    tc = _cac(tst, "TaxCategory")
    _cbc(tc, "ID", vat_cat)                                          # BT-118
    if not is_klein:
        _cbc(tc, "Percent", _fmt(ust_satz))                          # BT-119
    else:
        # STEUERBERATER FLAG: exemption reason code for §19 UStG. Using VATEX-EU-O
        # (Not subject to VAT per national law); confirm with tax advisor before
        # production use. Some systems expect category 'E' or a different code.
        _cbc(tc, "TaxExemptionReasonCode", _VAT_EXEMPT_REASON_CODE)
        _cbc(tc, "TaxExemptionReason", _VAT_EXEMPT_REASON_TEXT)
    tc_ts = _cac(tc, "TaxScheme")
    _cbc(tc_ts, "ID", "VAT")

    # ── BG-22 Document totals (LegalMonetaryTotal) ─────────────────────────
    lmt = _cac(inv, "LegalMonetaryTotal")
    # UBL 2.1 sequence: LineExtension → TaxExclusive → TaxInclusive → Allowance → Charge → Payable
    _cbc(lmt, "LineExtensionAmount", _fmt(line_ext), currencyID=currency)      # BT-106
    _cbc(lmt, "TaxExclusiveAmount", _fmt(netto_adj), currencyID=currency)      # BT-109 = adjusted net
    _cbc(lmt, "TaxInclusiveAmount", _fmt(summe_brutto), currencyID=currency)   # BT-112
    if nachlass:
        _cbc(lmt, "AllowanceTotalAmount", _fmt(nachlass), currencyID=currency) # BT-107
    if zuschlag:
        _cbc(lmt, "ChargeTotalAmount", _fmt(zuschlag), currencyID=currency)    # BT-108
    _cbc(lmt, "PayableAmount", _fmt(summe_brutto), currencyID=currency)        # BT-115

    # ── BG-25 Invoice lines ────────────────────────────────────────────────
    for idx, pos in enumerate(positions, start=1):
        line_id = str(pos.get("position_nr") or idx)
        menge = Decimal(str(pos.get("menge") or 1))
        gesamtpreis = Decimal(str(pos.get("gesamtpreis") or 0))
        einheitspreis = Decimal(str(pos.get("einheitspreis") or 0))
        bezeichnung = pos.get("bezeichnung") or f"Position {line_id}"
        unit_code = map_einheit(pos.get("einheit")) or "C62"

        il = _cac(inv, "InvoiceLine")
        _cbc(il, "ID", line_id)                         # BT-126
        _cbc(il, "InvoicedQuantity", f"{menge:.3f}", unitCode=unit_code)  # BT-129/BT-130
        _cbc(il, "LineExtensionAmount", _fmt(gesamtpreis), currencyID=currency)  # BT-131

        item = _cac(il, "Item")
        _cbc_if(item, "Description", bezeichnung)        # BT-154 (optional)
        _cbc(item, "Name", bezeichnung)                  # BT-153 (mandatory)
        ctc = _cac(item, "ClassifiedTaxCategory")
        _cbc(ctc, "ID", vat_cat)                         # BT-151
        if not is_klein:
            _cbc(ctc, "Percent", _fmt(ust_satz))         # BT-152
        ctc_ts = _cac(ctc, "TaxScheme")
        _cbc(ctc_ts, "ID", "VAT")

        price = _cac(il, "Price")
        _cbc(price, "PriceAmount", _fmt(einheitspreis), currencyID=currency)  # BT-146

    return ET.tostring(inv, encoding="utf-8", xml_declaration=True)
