# nfc_layout.py
#
# Single source of truth for how a credential is stored on an NTAG215 card.
# Both nfc_writer.py and nfc_reader.py import from here so the layout cannot
# drift between them.
#
# The card holds three fields laid out back to back:
#
#   [ 32 bytes student_id ][ 32 bytes secret ][ 64 bytes college signature ]
#
# student_id and secret are Aztec Field elements serialized big-endian into 32
# bytes each. The signature is an ECDSA signature over the student id made with
# the college key: raw r||s, 32 bytes each, as produced by the ieee-p1363
# encoding. It is not a number modulo anything, just opaque bytes.
#
# That comes to 128 bytes in pages 4..35. NTAG215 user memory starts at page 4
# and holds 504 bytes, so there is still room to spare.
#
# The college public key deliberately does NOT live on the card. It belongs in
# the contract: a card that carried its own key could be handed a forged
# signature together with the matching key and would verify happily.

# BN254 scalar field modulus - every Aztec Field element must be below this.
FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617

FIELD_BYTES = 32
# secp256r1 signature as raw r||s, 32 bytes per half.
SIGNATURE_BYTES = 64
PAGE_SIZE = 4
FIRST_PAGE = 4

# Offsets of each field inside the payload.
STUDENT_ID_OFFSET = 0
SECRET_OFFSET = STUDENT_ID_OFFSET + FIELD_BYTES
SIGNATURE_OFFSET = SECRET_OFFSET + FIELD_BYTES

PAYLOAD_BYTES = SIGNATURE_OFFSET + SIGNATURE_BYTES
LAST_PAGE = FIRST_PAGE + PAYLOAD_BYTES // PAGE_SIZE - 1


def check_field(value, name):
    """Reject anything that is not a valid Field element."""
    if value < 0 or value >= FIELD_MODULUS:
        raise ValueError(f"{name} must be in [0, FIELD_MODULUS), got {value}")
    return value


def check_signature(signature):
    """Reject anything that is not a raw 64-byte r||s signature.

    Length is all we can check here. Whether the signature is actually valid is
    decided by the contract, which holds the college public key.
    """
    if len(signature) != SIGNATURE_BYTES:
        raise ValueError(f"signature must be {SIGNATURE_BYTES} bytes, got {len(signature)}")
    return bytes(signature)


def parse_field(raw, name):
    """Parse a decimal string into a Field element."""
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a decimal integer, got {raw!r}")
    return check_field(value, name)


def encode_payload(student_id, secret, signature):
    """Serialize a credential into the 128 bytes stored on the card."""
    check_field(student_id, "student_id")
    check_field(secret, "secret")
    check_signature(signature)
    return (
        student_id.to_bytes(FIELD_BYTES, "big")
        + secret.to_bytes(FIELD_BYTES, "big")
        + bytes(signature)
    )


def decode_payload(payload):
    """Parse the 128 bytes read off a card back into (student_id, secret, signature)."""
    if len(payload) != PAYLOAD_BYTES:
        raise ValueError(f"Expected {PAYLOAD_BYTES} bytes, got {len(payload)}")

    student_id = int.from_bytes(payload[STUDENT_ID_OFFSET:SECRET_OFFSET], "big")
    secret = int.from_bytes(payload[SECRET_OFFSET:SIGNATURE_OFFSET], "big")
    signature = bytes(payload[SIGNATURE_OFFSET:])

    # A blank or foreign card reads back as 0xFF..., which is not a valid Field.
    # The signature bytes have no such structure to check, so these two guards
    # are what stops garbage from travelling any further.
    check_field(student_id, "student_id")
    check_field(secret, "secret")
    check_signature(signature)
    return student_id, secret, signature
