import bcrypt from "bcryptjs";
import {
  createLocalPasswordComputeAdapter,
  LOCAL_PASSWORD_COMPUTE_ROUNDS,
  LOCAL_PASSWORD_COMPUTE_SHARD_COUNT,
  localPasswordComputeShardName,
  PasswordComputeUnavailableError,
  type LocalPasswordComputeBinding,
} from "../../../src/lib/cloudflare/local-password-compute";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Disposable local Worker coverage; no password or hash is returned/logged. */
export async function testPasswordCompute(
  binding: LocalPasswordComputeBinding,
) {
  const adapter = createLocalPasswordComputeAdapter(binding);
  const password = "fixture-password-2026";
  const passwordHash = await adapter.hashPassword(password, "fixture-login");
  check(
    bcrypt.getRounds(passwordHash) === LOCAL_PASSWORD_COMPUTE_ROUNDS,
    "password hash is not bcrypt12",
  );
  check(
    await adapter.comparePassword(password, passwordHash, "fixture-login"),
    "password verifies",
  );
  check(
    await adapter.verifyPassword(password, passwordHash, "fixture-login"),
    "auth-compatible password verifier verifies",
  );
  check(
    !(await adapter.comparePassword(
      "wrong-password",
      passwordHash,
      "fixture-login",
    )),
    "wrong password is refused",
  );
  check(
    await bcrypt.compare(password, passwordHash),
    "standard bcrypt compare accepts adapter hash",
  );

  const pin = "482957";
  const pinHash = await adapter.hashPin(pin, "fixture-device");
  check(
    bcrypt.getRounds(pinHash) === LOCAL_PASSWORD_COMPUTE_ROUNDS,
    "PIN hash is not bcrypt12",
  );
  check(
    await adapter.comparePin(pin, pinHash, "fixture-device"),
    "PIN verifies",
  );
  check(
    await adapter.verifyPin(pin, pinHash, "fixture-device"),
    "auth-compatible PIN verifier verifies",
  );
  check(
    !(await adapter.comparePin("000000", pinHash, "fixture-device")),
    "wrong PIN is refused",
  );

  const shardNames = new Set([
    localPasswordComputeShardName("password", "fixture-login"),
    localPasswordComputeShardName("pin", "fixture-device"),
  ]);
  check(
    shardNames.size <= LOCAL_PASSWORD_COMPUTE_SHARD_COUNT,
    "password compute escaped fixed shard bound",
  );
  check(
    [...shardNames].every((name) =>
      /^local-password-compute-[0-3]$/.test(name),
    ),
    "password compute object name leaked routing data",
  );

  let missingBindingHonest = false;
  try {
    createLocalPasswordComputeAdapter(undefined);
  } catch (error) {
    missingBindingHonest = error instanceof PasswordComputeUnavailableError;
  }
  check(
    missingBindingHonest,
    "missing password compute binding silently fell back",
  );
  return {
    bcrypt12: true,
    password: true,
    pin: true,
    boundedShards: true,
    missingBindingHonest: true,
  };
}
