watch:
	find -name '*.ts'| entr -r -s "make test" 

test:
	deno test --allow-net --allow-env --allow-run --allow-write --allow-read

test-debug:
	deno test --allow-net --allow-env --allow-run --allow-write --allow-read --inspect-brk test

.PHONY: test test-debug watch
