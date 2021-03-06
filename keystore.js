const assert = require("assert");

const {promiseEvent} =require("junk-bucket/future");
const {crypto_scrypt, crypto_random, ToJSON, AsBuffer, MemoryWritable, MemoryObjectWritable, ToString} = require("./junk");
const crypto = require("crypto");

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

async function promisePiped( from, to ){
	const completion = promiseEvent( to, "finish");
	const result = from.pipe(to);
	await completion;
	return result;
}

class KeyStore {
	constructor(vfs) {
		this.vfs = vfs;
	}

	requireUnsealed( operation = "unknown"){
		if( !this.rootKey ) {
			throw new Error("KeyStore must be unsealed before performing " + operation);
		}
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
			const parameters = await this.vfs.createReadableStream(keyName);
			const cipher = crypto.createCipheriv(algorithm, this.rootKey.key, this.rootKey.iv);
			const memoryBuffer = new MemoryWritable();
			await promisePiped(parameters.pipe(cipher),memoryBuffer);

			const key = memoryBuffer.bytes.slice(0,16);
			const iv = memoryBuffer.bytes.slice(16, 32);
			return crypto.createCipheriv(algorithm, key, iv);
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

	async nameForFile( file ){
		this.requireUnsealed("nameForFile");
		const hash = crypto.createHmac('sha256', this.rootKey.iv)
			.update(file)
			.digest('hex');
		return hash;
	}
}

class KeyManagedVFS {
	constructor( keys, vfs ){
		this.keys = keys;
		this.vfs = vfs;
	}

	async putBytes( file, bytes ){
		const outputStream = await this.createWritableStream(file);
		const done = promiseEvent(outputStream,"finish");
		outputStream.end(bytes);
		await done;
	}

	async asBytes( file ){
		const buffer = new MemoryWritable();
		const inputStream = await this.createReadableStream(file);
		await promisePiped(inputStream, buffer);
		return buffer.bytes;
	}

	async createWritableStream( file ){
		const cipherSink = await this.keys.cipherStreamFor( file );
		const encryptedFileName = await this.keys.nameForFile(file);
		const output = await this.vfs.createWritableStream(encryptedFileName);
		cipherSink.pipe(output);
		return cipherSink;
	}

	async createReadableStream( file ){
		const encryptedFileName = await this.keys.nameForFile(file);
		try {
			const inputStream = await this.vfs.createReadableStream(encryptedFileName);
			const cipherTransform = await this.keys.decipherStreamFor(file);
			inputStream.pipe(cipherTransform);
			return cipherTransform;
		}catch(e){
			throw new Error("Unable to create readable stream for " + file + " because " + e.message);
		}
	}

	async exists(file){
		this.keys.requireUnsealed("vfs.exists");
		const encryptedFileName = await this.keys.nameForFile(file);
		return await this.vfs.exists(encryptedFileName);
	}
}

module.exports = {
	KeyStore
};