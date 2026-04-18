.PHONY: lint unit

install:
	@npm install

lint:
	@npm run fmt && npx tsc --noEmit

unit:
	@npm run test:unit
