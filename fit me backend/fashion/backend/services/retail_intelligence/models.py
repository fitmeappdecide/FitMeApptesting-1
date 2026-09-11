from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Set

@dataclass
class RetailProfile:
    id: str
    name: str
    resolved: bool = True
    affiliate_supported: bool = True
    affiliate_type: str = "utm_tagging"
    affiliate_expiry: Optional[str] = "30d"
    known_domains: Set[str] = field(default_factory=set)
