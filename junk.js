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


class InMemoryVFS {
	constructor() {
		this.files = {};
	}

	async exists( file ){
		return !!this.files[file];
	}

	async unlink( file ){
		if( this.files[file] ){
			delete this.files[file];
		}
	}

	async createReadableStream( file ){
		if( !(await this.exists(file)) ){
			throw new Error("No such file "+ file);
		}
		return new MemoryReadable(this.files[file]);
	}

	async asBytes( file ){
		return this.files[file];//TODO: This should provide a copy, not the original
	}

	async putBytes( file, bytes, encoding ){
		this.files[file] = Buffer.from(bytes, encoding);
	}

	async createWritableStream( file ){
		const writable = new MemoryWritable();
		writable.on("finish", () => {
			this.files[file] = writable.bytes;
		});
		return writable;
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

module.exports ={
	crypto_random,
	crypto_scrypt,
	ToJSON,
	ToString,
	AsBuffer,
	MemoryReadable,
	MemoryWritable,
	MemoryObjectWritable,
	InMemoryVFS
};
