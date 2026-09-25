"""db.py — DB接続とテーブル定義"""
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text,
                        create_engine, func, inspect, select, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

BASE = Path(__file__).parent


def _db_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        return f"sqlite:///{BASE / 'local.db'}"
    # Render は postgres:// / postgresql:// を渡すので psycopg(v3) ドライバを明示
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


engine = create_engine(_db_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

MEALS = ("dinner", "breakfast")
# developer: 最上位ロール(管理者の全権限 + 入場済の操作)
ROLES = {"developer": "developper", "admin": "管理者", "front": "フロント", "restaurant": "レストラン"}
ADMIN_ROLES = ("developer", "admin")  # 管理者ページ・管理者APIを使えるロール
ENTRY_ROLES = ("developer", "restaurant")  # 入場済を操作できるロール
DEFAULT_SLOTS = {
    "dinner": ["17:30", "18:00", "18:30", "19:00", "19:30", "20:00"],
    "breakfast": ["07:00", "07:30", "08:00", "08:30", "09:00"],
}


JST = timezone(timedelta(hours=9))


def now_jst() -> datetime:
    """記録用の現在時刻(日本時間, tz情報なし)"""
    return datetime.now(JST).replace(tzinfo=None, microsecond=0)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="front")  # ROLES のキー
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)  # role が ADMIN_ROLES か(旧列、同期のみ)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(16))  # 投稿時点の役割
    body: Mapped[str] = mapped_column(Text, default="")
    reservation_id: Mapped[int | None] = mapped_column(ForeignKey("reservations.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_jst)
    retracted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # 取り消し(本文はDBに残す)


class AuthLog(Base):
    """ログイン・ログアウト・パスワード変更の記録(追記のみ)"""
    __tablename__ = "auth_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=now_jst, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    username: Mapped[str] = mapped_column(String(64), default="")  # 入力されたログインID(失敗時の記録用)
    action: Mapped[str] = mapped_column(String(32))  # login / login_failed / logout / password_change


class ChatRead(Base):
    """ユーザーごとの既読位置"""
    __tablename__ = "chat_reads"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    last_read_id: Mapped[int] = mapped_column(Integer, default=0)


class TimeSlot(Base):
    __tablename__ = "time_slots"
    id: Mapped[int] = mapped_column(primary_key=True)
    meal: Mapped[str] = mapped_column(String(16), index=True)
    label: Mapped[str] = mapped_column(String(16))  # "18:00"
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Reservation(Base):
    __tablename__ = "reservations"
    id: Mapped[int] = mapped_column(primary_key=True)
    meal: Mapped[str] = mapped_column(String(16), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    room: Mapped[str] = mapped_column(String(32))
    guest_name: Mapped[str] = mapped_column(String(128))
    adults: Mapped[int] = mapped_column(Integer, default=0)
    children: Mapped[int] = mapped_column(Integer, default=0)
    infants: Mapped[int] = mapped_column(Integer, default=0)
    # 内訳の人数: 大人クーポン(食事付) / フリー大人(生打ち) / フリー子供(生打ち) / 子供クーポン(食事付) / 外来
    adult_coupon: Mapped[int] = mapped_column(Integer, default=0)
    free_adult: Mapped[int] = mapped_column(Integer, default=0)
    free_child: Mapped[int] = mapped_column(Integer, default=0)
    child_coupon: Mapped[int] = mapped_column(Integer, default=0)
    outside: Mapped[int] = mapped_column(Integer, default=0)
    time_slot: Mapped[str | None] = mapped_column(String(16), nullable=True)  # None = 未定
    nights: Mapped[int] = mapped_column(Integer, default=1)    # 泊数
    night_no: Mapped[int] = mapped_column(Integer, default=1)  # 何泊目か
    stay_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # 連泊分をまとめるID
    group_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # グループ登録で紐づいた予約の共通ID
    allergy: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_jst)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_jst)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # None = 有効
    deleted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    entered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # ステータス: None=空白, あり=入場済
    entered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class ReservationHistory(Base):
    """予約の変更履歴(追記のみ)"""
    __tablename__ = "reservation_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    reservation_id: Mapped[int] = mapped_column(ForeignKey("reservations.id"), index=True)
    action: Mapped[str] = mapped_column(String(16))  # create / update / delete / restore
    changes: Mapped[dict] = mapped_column(JSON, default=dict)  # {項目: [変更前, 変更後]}
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=now_jst)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


# 既存テーブルに後から追加した列: (テーブル, 列, 型とデフォルト, 追加直後に流すSQL)
ADDED_COLUMNS = [
    ("reservations", "nights", "INTEGER NOT NULL DEFAULT 1", None),
    ("reservations", "night_no", "INTEGER NOT NULL DEFAULT 1", None),
    ("reservations", "stay_id", "VARCHAR(32)", None),
    ("reservations", "group_id", "VARCHAR(32)", None),
    ("users", "role", "VARCHAR(16) NOT NULL DEFAULT 'front'", "UPDATE users SET role = 'admin' WHERE is_admin"),
    ("reservations", "entered_at", "TIMESTAMP", None),
    ("reservations", "entered_by", "INTEGER", None),
    ("reservations", "adult_coupon", "INTEGER NOT NULL DEFAULT 0", None),
    ("reservations", "free_adult", "INTEGER NOT NULL DEFAULT 0", None),
    ("reservations", "free_child", "INTEGER NOT NULL DEFAULT 0", None),
    ("reservations", "child_coupon", "INTEGER NOT NULL DEFAULT 0", None),
    ("reservations", "outside", "INTEGER NOT NULL DEFAULT 0", None),
]


def _migrate() -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, col, ddl, backfill in ADDED_COLUMNS:
            if col not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                if backfill:
                    conn.execute(text(backfill))


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate()
    with Session(engine) as s:
        for meal in MEALS:
            if s.scalar(select(func.count()).select_from(TimeSlot).where(TimeSlot.meal == meal)) == 0:
                s.add_all(TimeSlot(meal=meal, label=l, sort=i) for i, l in enumerate(DEFAULT_SLOTS[meal]))
        s.commit()
