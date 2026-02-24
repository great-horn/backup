"""Shared utilities to avoid circular imports."""

import os
from datetime import datetime
import pytz

LOCAL_TZ = pytz.timezone(os.environ.get('TZ', 'Europe/Zurich'))


def get_local_datetime():
    """Return the current local datetime."""
    return datetime.now(LOCAL_TZ)
