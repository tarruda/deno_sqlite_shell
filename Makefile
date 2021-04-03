watch:
	find -name '*.ts'| entr -r -s "make test" 

test:
	deno test --allow-run

test-debug:
	deno test --allow-run --inspect-brk test

.PHONY: test test-debug watch
