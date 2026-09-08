const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
)?.get;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;

export type BoundedByteStreamChunkV1 =
  | Readonly<{ status: 'copied'; chunk: Buffer; byteLength: number }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'resource_limit_exceeded' }>;

const MAXIMUM_BYTE_STREAM_CHUNKS_V1 = 4_000_000;

export function maximumByteStreamChunksV1(maxRecords: number): number {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error('byte_stream_resource_config_invalid');
  }
  return Math.min(MAXIMUM_BYTE_STREAM_CHUNKS_V1, maxRecords * 2);
}

export function copyBoundedByteStreamChunkV1(
  value: unknown,
  remainingBytes: number,
  remainingChunks = 1,
): BoundedByteStreamChunkV1 {
  try {
    if (
      !Number.isSafeInteger(remainingBytes)
      || remainingBytes < 0
      || !Number.isSafeInteger(remainingChunks)
      || remainingChunks < 1
    ) {
      return { status: 'resource_limit_exceeded' };
    }
    const byteLength = typeof value === 'string'
      ? Buffer.byteLength(value)
      : intrinsicUint8ArrayByteLength(value);
    if (byteLength === 0) return { status: 'invalid' };
    if (byteLength > remainingBytes) return { status: 'resource_limit_exceeded' };
    if (typeof value === 'string') {
      return { status: 'copied', chunk: Buffer.from(value), byteLength };
    }
    const chunk = Buffer.allocUnsafe(byteLength);
    chunk.set(value as Uint8Array);
    return { status: 'copied', chunk, byteLength };
  } catch {
    return { status: 'invalid' };
  }
}

function intrinsicUint8ArrayByteLength(value: unknown): number {
  if (!typedArrayByteLengthGetter || !typedArrayTagGetter || !ArrayBuffer.isView(value)) {
    throw new TypeError('chunk is not a Uint8Array');
  }
  const byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []);
  if (Reflect.apply(typedArrayTagGetter, value, []) !== 'Uint8Array') {
    throw new TypeError('chunk is not a Uint8Array');
  }
  return byteLength;
}
