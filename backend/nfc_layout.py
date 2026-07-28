# nfc_layout.py
#
# Single source of truth for how a (student_id, secret) pair is stored on an
# NTAG215 card. Both nfc_writer.py and nfc_reader.py import from here so the
# layout cannot drift between them.
#
# Each value is one Aztec Field serialized big-endian into 32 bytes, so the
# payload is 64 bytes in pages 4..19. NTAG215 user memory starts at page 4 and
# holds 504 bytes, so there is room to spare.

# BN254 scalar field modulus - every Aztec Field element must be below this.
FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617

FIELD_BYTES = 32
PAGE_SIZE = 4
FIRST_PAGE = 4
PAYLOAD_BYTES = FIELD_BYTES * 2
LAST_PAGE = FIRST_PAGE + PAYLOAD_BYTES // PAGE_SIZE - 1


def check_field(value, name):
    """Reject anything that is not a valid Field element."""
    if value < 0 or value >= FIELD_MODULUS:
        raise ValueError(f"{name} must be in [0, FIELD_MODULUS), got {value}")
    return value


def parse_field(raw, name):
    """Parse a decimal string into a Field element."""
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a decimal integer, got {raw!r}")
    return check_field(value, name)


def encode_payload(student_id, secret):
    """Serialize the pair into the 64 bytes stored on the card."""
    check_field(student_id, "student_id")
    check_field(secret, "secret")
    return student_id.to_bytes(FIELD_BYTES, "big") + secret.to_bytes(FIELD_BYTES, "big")


def decode_payload(payload):
    """Parse the 64 bytes read off a card back into (student_id, secret)."""
    if len(payload) != PAYLOAD_BYTES:
        raise ValueError(f"Expected {PAYLOAD_BYTES} bytes, got {len(payload)}")
    student_id = int.from_bytes(payload[:FIELD_BYTES], "big")
    secret = int.from_bytes(payload[FIELD_BYTES:], "big")
    # A blank or foreign card reads back as 0xFF..., which is not a valid Field.
    check_field(student_id, "student_id")
    check_field(secret, "secret")
    return student_id, secret
