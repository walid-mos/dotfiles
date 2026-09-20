#!/Users/walid-mos/.local/share/nextnode-qonto/venv/bin/python
# Loader de secours — le source forwarder.py a disparu (~2026-09-19 15:09),
# seul le bytecode compilé du 16/09 subsiste dans __pycache__.
# Ce fichier exécute ce bytecode tel quel (même interpréteur 3.11 du venv).
import marshal
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PYC = os.path.join(_HERE, "__pycache__", "forwarder.cpython-311.pyc")

with open(_PYC, "rb") as _f:
    _data = _f.read()

_code = marshal.loads(_data[16:])  # saute l'en-tête .pyc (16 octets, py3.11)
sys.argv[0] = __file__
exec(_code, {"__name__": "__main__", "__file__": __file__,
             "__package__": None, "__doc__": None, "__spec__": None})
