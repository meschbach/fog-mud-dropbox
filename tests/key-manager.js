const {expect} = require("chai");

const {promisify} = require("util");
const {Transform, Writable, Readable} = require("stream");

const {InMemoryVFS} = require("../junk");
const {KeyStore} = require("../keystore");

const testScrypt = {
	cost: 2
};
describe("KeyStore", function () {
	describe("When uninitialized", function(){
		it("is uninitialized", async function(){
			const vfs = new InMemoryVFS();
			const keyManager = new KeyStore(vfs);
			expect(await keyManager.isInitialized()).to.be.false;
		});
	});

	describe("When initialized", function(){
		beforeEach(async function () {
			this.vfs = new InMemoryVFS();
			this.keyManager =  new KeyStore(this.vfs);
			await this.keyManager.initialize("test", {scrypt: testScrypt});

			this.reloadFileName = "survive";
			this.reloadFileBytes = Buffer.from("collide", "utf-8");
			const encryptedVFS = await this.keyManager.asVFS();
			await encryptedVFS.putBytes(this.reloadFileName, this.reloadFileBytes);
		});

		it("registers as initialized", async function () {
			expect(await this.keyManager.isInitialized()).to.be.true;
		});

		it("the file name is encrypted", async function () {
			expect(await this.vfs.exists(this.reloadFileName)).to.be.false;
		});

		it("is not in plain text", async function () {
			let problem = false;
			try {
				const bytes = await this.vfs.asBytes("keys.v0");
				const str = bytes.toString("utf-8");
				const object = JSON.parse(str);
			}catch( error ){
				problem = error;
			}
			expect( !!problem ).to.be.true;
		});

		describe("And writing a new file with the VFS", function(){
			it("is in ciphertext", async function() {
				const example = Buffer.from("Shine your light", "utf-8");

				const encryptedVFS = await this.keyManager.asVFS();
				await encryptedVFS.putBytes("vfs-write", example);
				const rawBytes = await this.vfs.asBytes("vfs-write");
				expect( rawBytes ).to.not.deep.eq(example);
			});
			it("is readable again", async function() {
				const example = Buffer.from("Time is calling by name", "utf-8");
				const name = "enchantment";

				const encryptedVFS = await this.keyManager.asVFS();
				await encryptedVFS.putBytes(name, example);
				const rawBytes = await encryptedVFS.asBytes(name);
				expect( rawBytes ).to.deep.eq(example);
			});
		});

		describe("And loaded again", function () {
			it("is initialized", async function () {
				const nextStore = new KeyStore(this.vfs);
				expect(await nextStore.isInitialized()).to.be.true;
			});

			it("able to read previously written files", async function () {
				const nextStore = new KeyStore(this.vfs);
				await nextStore.unseal("test",{scrypt: testScrypt});
				const vfs = await nextStore.asVFS();
				const bytes = await vfs.asBytes(this.reloadFileName);
				expect(bytes).to.deep.eq(this.reloadFileBytes);
			});
		});
	});
});
