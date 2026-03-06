.PHONY: lint unit

lint:
	@npm run fmt && npx tsc --noEmit

unit:
	@npm run test:unit
