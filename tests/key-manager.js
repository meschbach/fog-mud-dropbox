const {expect} = require("chai");
const assert = require("assert");

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

const crypto = require("crypto");
const {promisify} = require("util");
const crypto_random = promisify(crypto.randomBytes);
const crypto_scrypt = promisify(crypto.scrypt);

const {Transform, Writable, Readable} = require("stream");

class ToJSON extends Transform {
	constructor() {
		super({objectMode:true});
	}

	_transform( object, encoding, cb ){
		let err, value;
		try {
			value = JSON.stringify(object);
		}catch( e ){
			err = e;
		}
		cb(err, value);
	}
}

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

class AsBuffer extends Transform {
	constructor() {
		super({writeObjectMode:true, readObjectMode: false});
	}

	_transform( object, encoding, cb ){
		let err, asBytes;
		try {
			asBytes = Buffer.from(object, encoding || "utf-8");
		}catch( e ){
			err = e;
		}
		cb(err, asBytes);
	}
}

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

class MemoryReadable extends Readable {
	constructor(source, props) {
		super(props);
		this.bytes = source;
		this.pushed = false;
	}

	_read( size ){
		if( !this.pushed ) {
			this.pushed = true;
			this.push(this.bytes);
		} else {
			this.push(null);
		}
	}
}

const algorithm = 'aes-128-cbc';
function encryptedJSONStream( key, iv, traget ){
	const stringify = new ToJSON();
	const bytes = new AsBuffer();
	const cipher = crypto.createCipheriv(algorithm, key, iv);

	stringify.pipe(bytes).pipe(cipher).pipe( traget );
	return stringify;
}

function decryptJSONStream( key, iv, source ){
	const jsonBuffer = new MemoryObjectWritable();
	const strings = new ToString();
	const decipher = crypto.createDecipheriv(algorithm, key, iv);

	source.pipe( decipher ).pipe(strings).pipe(json);
	return json;
}

const {promiseEvent} =require("junk-bucket/future");
class KeyStore {
	constructor(vfs) {
		this.vfs = vfs;
	}

	async isInitialized() {
		if( !await this.vfs.exists("keys.v0") ) return false;
		return true;
	}

	async initialize( secret, options = {} ){
		assert(secret);
		if( await this.isInitialized()){
			throw new Error("Already initialized");
		}

		//Derive key
		const secretIV = crypto.createHmac('sha256', secret)
			.update(secret)
			.digest();
		const scryptOptions = Object.assign({}, options.scrypt  || {});
		const userSecret = await crypto_scrypt(secret, secretIV, 16, scryptOptions);

		//Generate a new key
		const key = await crypto_random(16);
		const iv = await crypto_random(16);
		this.rootKey = {
			key, iv
		};

		//Creates a new keys file
		const metadata = { v: 0, keys: [] } ;
		metadata.keys.push({key,iv});
		const target = await this.vfs.createWritableStream("keys.v0");
		const sink = encryptedJSONStream(userSecret,secretIV.slice(0,16),target);
		const finished = promiseEvent(target,"finish");
		sink.end(metadata);
		await finished;
	}

	async unseal(secret, options = {} ){
		assert(secret);
		const scryptOptions = Object.assign({}, options.scrypt  || {});
		const secretIV = crypto.createHmac('sha256', secret)
			.update(secret)
			.digest();
		const userSecret = await crypto_scrypt(secret, secretIV, 16, scryptOptions);

		//Load the file
		const cipherTextMetadata = await this.vfs.createReadableStream("keys.v0");
		const jsonBuffer = new MemoryObjectWritable();
		const strings = new ToString();
		const decipher = crypto.createDecipheriv(algorithm, userSecret, secretIV.slice(0,16));

		const finished = promiseEvent(jsonBuffer, "finish");
		cipherTextMetadata.pipe( decipher ).pipe(strings).pipe(jsonBuffer);
		await finished;

		//Combined all text fragments
		const text = jsonBuffer.objects.join("");
		const metadata = JSON.parse(text);

		const externalizedKey = metadata.keys[0];
		const key = Buffer.from(externalizedKey.key.data);
		const iv = Buffer.from(externalizedKey.iv.data);
		this.rootKey = {
			key: key,
			iv: iv
		};
	}

	async cipherStreamFor( file ){
		const hash = crypto.createHmac('sha256', this.rootKey.iv)
			.update(file)
			.digest('hex');
		const keyName = "keys.0/" + hash;
		if( await this.vfs.exists(keyName) ){
			//Load key details
		} else {
			//Generate a new key
			const key = await crypto_random(16);
			const iv = await crypto_random(16);
			const cipher = crypto.createCipheriv(algorithm, this.rootKey.key, this.rootKey.iv);
			const sink = await this.vfs.createWritableStream(keyName);
			cipher.pipe(sink);
			const done = promiseEvent(sink, "finish");
			cipher.write(key);
			cipher.write(iv);
			cipher.end();

			const stream = crypto.createCipheriv(algorithm, key, iv);
			await done;
			return stream;
		}
	}

	async decipherStreamFor( file ){
		assert(this.rootKey, "Not unsealed");
		const hash = crypto.createHmac('sha256', this.rootKey.iv)
			.update(file)
			.digest('hex');
		const keyName = "keys.0/" + hash;
		if( await this.vfs.exists(keyName) ){
			//Generate a new key
			const source = await this.vfs.createReadableStream(keyName);
			const cipher = crypto.createDecipheriv(algorithm, this.rootKey.key, this.rootKey.iv);
			const buffer = new MemoryWritable();
			const done = promiseEvent(buffer, "finish");
			source.pipe(cipher).pipe(buffer);
			await done;

			const stream = crypto.createDecipheriv(algorithm, buffer.bytes.slice(0,16),  buffer.bytes.slice(16));
			return stream;
		} else {
			throw new Error("TODO");
		}
	}

	async asVFS(){ return new KeyManagedVFS( this, this.vfs ); }
}

class KeyManagedVFS {
	constructor( keys, vfs ){
		this.keys = keys;
		this.vfs = vfs;
	}

	async putBytes( file, bytes ){
		const cipherSink = await this.keys.cipherStreamFor( file );
		const output = await this.vfs.createWritableStream(file);

		cipherSink.pipe(output);
		const done = promiseEvent(output,"finish");
		cipherSink.end(bytes);
		await done;
	}

	async asBytes( file ){
		const buffer = new MemoryWritable();
		const decipherment = await this.keys.decipherStreamFor( file );
		const source = await this.vfs.createReadableStream(file);
		const completed = promiseEvent(buffer,"finish");
		source.pipe(decipherment).pipe(buffer);
		await completed;
		return buffer.bytes;
	}
}

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