"""Interpret Sendo's issue labels alongside the follow-up text that explains them."""
from datetime import timezone
import re
import unicodedata


PRODUCT_LABELS = {
    "too_small": "Too small", "too_large": "Too large", "quality": "Quality",
    "material": "Material", "color": "Color", "odor": "Odor", "durability": "Durability",
    "damaged": "Arrived damaged",
}
DELIVERY_LABELS = {
    "late_delivery": "Late delivery", "cancelled_by_phone": "Cancelled by phone",
    "personal": "Personal reason", "not_ordered": "Customer did not order",
    "wrong_item": "Wrong item sent", "missing_items": "Missing items",
}
# Match explicit complaints. Bare mentions of size, color or quality in a note
# can also be instructions, praise, or an order confirmation.
PRODUCT_PHRASES = {
    "Too small": re.compile(r"\b(?:too (?:small|tight)|runs? small|trop petit\w*|trop serre\w*|"
                            r"(?:jat(?:ha|o|ni)?|ja(?:ha|ni)) s(?:gh|ghr|g)ir\w*|جات(?:ها|ني)? صغير\w*)\b"),
    "Larger size requested": re.compile(r"\b(?:wants? (?:a )?(?:larger|bigger) size|"
                                        r"(?:b4at|bghat|bgha) (?:nemra|nmra|taille) k(?:b|br|ber)\w*)\b"),
    "Too large": re.compile(r"\b(?:too (?:large|big|loose)|runs? (?:large|big)|trop grand\w*|"
                            r"jat(?:ha|o|ni)? kbir\w*|جات(?:ها|ني)? كبير\w*)\b"),
    "Different from the photo": re.compile(r"(?:machi (?:bhal|b7al|b7el)|pas comme|different\w* (?:de|from)|"
                                           r"(?:doesn.t|didn.t|does not|did not) (?:look like|match)|"
                                           r"ماشي (?:بحال|كيف))\s+(?:(?:la|the|l|f|sur la|listing) )*"
                                           r"(?:photo|picture|image|تصوير\w*|الصور\w*)"),
    "Open at the side": re.compile(r"\b(?:m[7h]loul\w*|mhlol\w*|open(?:ed)?|ouvert\w*)"
                                   r"\s+(?:mn jnab|at the side|on the side|sur le cote)\b"),
    "Disliked the style": re.compile(r"(?:ma ?3j\w{2,14}(?:ch|sh)|didn.t like|did not like|"
                                     r"n.a pas aime|ماعجب\w*)\s+(?:(?:gae|ga3|le|la|the|had) )*"
                                     r"(?:model\w*|style|design|الموديل|الشكل)"),
    "Quality": re.compile(r"\b(?:poor quality|bad quality|mauvaise qualite|qualite mediocre|"
                          r"ma ?3j\w{2,16}(?:ch|sh)\s+(?:la )?qualite|جودة رديئة|جودة ضعيفة)\b"),
}
OPERATIONS_PHRASES = {
    "Duplicate order": re.compile(r"\b(?:duplicat[ae]\w*|doublon|double (?:commande|order)|"
                                  r"commande (?:en )?double|(?:hadi|commande) doubal|طلب مكرر)\b"),
    "No answer": re.compile(r"\b(?:pas de reponse|no answer|unreachable|m[ajk]*tj?w[b]+(?:ch|sh)|"
                            r"ne repond pas|لا يجيب)\b"),
    "Ordered elsewhere": re.compile(r"(?:ordered (?:it )?(?:elsewhere|somewhere else)|"
                                    r"command[ea]\w* (?:mn blasa khra|ailleurs))"),
}
NEGATED_FIT = re.compile(r"\b(?:not (?:too (?:small|large|tight|big)|a size issue)|"
                         r"(?:pas|jamais) trop (?:petit|grand|serre)\w*)\b")


def _plain(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text.casefold())
                   if not unicodedata.combining(c))


def _unique(values):
    return list(dict.fromkeys(v for v in values if v))


def parcel_issue(record, mixed_basket):
    """Return one row per order, preserving the source wording and overlapping reasons."""
    evidence = record.evidence
    product, operations = [], []
    product_times, delivery_times = [], []
    notes = _unique(e.note.strip() for e in evidence if e.note and e.note.strip())
    for e in evidence:
        content = NEGATED_FIT.sub("", _plain(e.note or ""))
        product_hits = [label for label, pattern in PRODUCT_PHRASES.items() if pattern.search(content)]
        delivery_hits = [label for label, pattern in OPERATIONS_PHRASES.items() if pattern.search(content)]
        product.extend(product_hits)
        operations.extend(delivery_hits)
        if e.at:
            when = e.at if e.at.tzinfo else e.at.replace(tzinfo=timezone.utc)
            if product_hits or e.reason in PRODUCT_LABELS:
                product_times.append(when)
            if delivery_hits or (e.reason and e.reason not in PRODUCT_LABELS):
                delivery_times.append(when)
    tagged_product = _unique(PRODUCT_LABELS.get(e.reason) for e in evidence)
    tagged_delivery = _unique(DELIVERY_LABELS.get(e.reason) for e in evidence)
    # Follow-up sometimes records a duplicate after an agent picked a product
    # label. Only count it as a product complaint if the text also supports one.
    corrected = "Duplicate order" in operations or "Ordered elsewhere" in operations
    if tagged_product and (product or not corrected):
        product.extend(tagged_product)
    operations.extend(tagged_delivery)
    if product:
        kind = "unattributed" if mixed_basket else "product"
        return kind, _unique(product + operations), notes, min(product_times, default=None)
    when = min(delivery_times, default=None)
    if operations or record.adverse or any(e.reason for e in evidence):
        return "delivery", _unique(operations) or ["Order issue recorded by Sendo"], notes, when
    # Pending contact and postponement are worth surfacing even before refusal.
    status = _plain(record.status)
    if not record.delivered and ("pas de reponse" in status or "reporte" in status):
        reason = "No answer" if "pas de reponse" in status else "Delivery postponed"
        return "delivery", [reason], notes, when
    return None
