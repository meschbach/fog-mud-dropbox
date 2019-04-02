const {expect} = require("chai");

class InMemoryVFS {
	constructor() {
		this.files = {};
	}

	async exists( file ){
		return !!this.files[file];
	}

	async createReadableStream( file ){
		if( !(await this.exists(file)) ){
			throw new Error("No such file "+ file);
		}
		return new MemoryReadable(this.files[file]);
	}

	async asBytes( file ){
		return this.files[file];
	}

	async createWritableStream( file ){
		const writable = new MemoryWritable();
		writable.on("finish", () => {
			this.files[file] = writable.bytes;
		});
		return writable;
	}
}

const {promisify} = require("util");

const {Transform, Writable, Readable} = require("stream");

// class FromJSON extends Transform {
// 	constructor() {
// 		super({objectMode:true});
// 	}
//
// 	_transform( object, encoding, cb ){
// 		try {
// 			console.log("FROM JSON",object.length);
// 			const value = JSON.parse(object);
// 			cb(null, value);
// 		}catch( e ){
// 			cb(e);
// 		}
// 	}
// }

class ToString extends Transform {
	constructor() {
		super({
			readableObjectMode: true,
			writableObjectMode: false
		});
	}

	_transform( object, encoding, cb ){
		let err, asString;
		try {
			asString = object.toString("utf-8");
		}catch( e ){
			err = e;
		}
		cb(err, asString);
	}
}

class MemoryWritable extends Writable {
	constructor(props) {
		super(props);
		this.bytes = Buffer.alloc(0);
	}

	_write(chunk, encoding, callback) {
		try {
			this.bytes = Buffer.concat([this.bytes, chunk]);
			callback(null);
		}catch(e){
			callback(e);
		}
	}
}

class MemoryObjectWritable extends Writable {
	constructor() {
		super({objectMode:true});
		this.objects = [];
	}

	_write(chunk, encoding, callback) {
		try {
			this.objects.push(chunk);
			callback(null);
		}catch(e){
			callback(e);
		}
	}
}

const {MemoryReadable} = require("../junk");

const {promiseEvent} = require("junk-bucket/future");
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