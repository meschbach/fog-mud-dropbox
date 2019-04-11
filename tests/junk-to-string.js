const {MemoryObjectWritable, ToString} = require("../junk");
const {promiseEvent} = require("junk-bucket/future");
const {expect} = require("chai");

describe("ToString", function () {
	describe("When given a buffer", function () {
		it("yields a string", async function () {
			const str = "here in our hearts";
			const bytes = Buffer.from(str, "utf-8");
			const transform = new ToString();
			const buffer = new MemoryObjectWritable();
			transform.pipe(buffer);
			const done = promiseEvent(buffer, "finish");
			transform.end(bytes);
			await done;
			expect( buffer.objects[0] ).to.deep.eq( str );
		});
	});
});
