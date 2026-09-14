from __future__ import annotations

from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from .settings import settings
from .db import connection


class ObjectStorage:
    def __init__(self) -> None:
        self.backend = settings.storage_backend.lower()
        self.local_root = Path(settings.storage_path)
        self._s3 = None
        if self.backend == "s3":
            self._s3 = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint_url,
                aws_access_key_id=settings.s3_access_key_id,
                aws_secret_access_key=settings.s3_secret_access_key,
                region_name=settings.s3_region,
                config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
            )

    def ensure_ready(self) -> None:
        if self.backend == "local":
            self.local_root.mkdir(parents=True, exist_ok=True)
            return
        if self.backend == "database":
            with connection() as conn:
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS fieldproof_object_storage (
                           object_key text PRIMARY KEY,
                           content bytea NOT NULL,
                           content_type text,
                           created_at timestamptz NOT NULL DEFAULT now()
                       )"""
                )
            return
        assert self._s3 is not None
        try:
            self._s3.head_bucket(Bucket=settings.s3_bucket)
        except Exception:
            self._s3.create_bucket(Bucket=settings.s3_bucket)

    def put_bytes(self, object_key: str, data: bytes, content_type: str | None = None) -> None:
        if self.backend == "local":
            path = self.local_root / object_key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return
        if self.backend == "database":
            with connection() as conn:
                conn.execute(
                    """INSERT INTO fieldproof_object_storage (object_key,content,content_type)
                       VALUES (%s,%s,%s)
                       ON CONFLICT (object_key) DO UPDATE
                       SET content=EXCLUDED.content, content_type=EXCLUDED.content_type""",
                    (object_key, data, content_type),
                )
            return
        assert self._s3 is not None
        kwargs = {"Bucket": settings.s3_bucket, "Key": object_key, "Body": data}
        if content_type:
            kwargs["ContentType"] = content_type
        self._s3.put_object(**kwargs)

    def get_bytes(self, object_key: str) -> bytes:
        if self.backend == "local":
            path = self.local_root / object_key
            if not path.exists():
                raise FileNotFoundError(object_key)
            return path.read_bytes()
        if self.backend == "database":
            with connection() as conn:
                row = conn.execute(
                    "SELECT content FROM fieldproof_object_storage WHERE object_key=%s",
                    (object_key,),
                ).fetchone()
            if not row:
                raise FileNotFoundError(object_key)
            return bytes(row["content"])
        assert self._s3 is not None
        try:
            response = self._s3.get_object(Bucket=settings.s3_bucket, Key=object_key)
            return response["Body"].read()
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"NoSuchKey", "404", "NoSuchBucket"}:
                raise FileNotFoundError(object_key) from exc
            raise

    def exists(self, object_key: str) -> bool:
        if self.backend == "local":
            return (self.local_root / object_key).exists()
        if self.backend == "database":
            with connection() as conn:
                row = conn.execute(
                    "SELECT 1 AS ok FROM fieldproof_object_storage WHERE object_key=%s",
                    (object_key,),
                ).fetchone()
            return bool(row)
        assert self._s3 is not None
        try:
            self._s3.head_object(Bucket=settings.s3_bucket, Key=object_key)
            return True
        except Exception:
            return False

    def delete(self, object_key: str) -> None:
        if self.backend == "local":
            (self.local_root / object_key).unlink(missing_ok=True)
            return
        if self.backend == "database":
            with connection() as conn:
                conn.execute("DELETE FROM fieldproof_object_storage WHERE object_key=%s", (object_key,))
            return
        assert self._s3 is not None
        self._s3.delete_object(Bucket=settings.s3_bucket, Key=object_key)


storage = ObjectStorage()
