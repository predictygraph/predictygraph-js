PDG_SRC ?= ../predictygraph
PY = uv run --with $(PDG_SRC) python

.PHONY: build test check themes fixtures

build:
	npx tsdown

test:
	npm test

check:
	npm run check

themes:
	PDG_SRC=$(PDG_SRC) $(PY) scripts/gen_themes.py

fixtures:
	$(PY) scripts/dump_layout.py
