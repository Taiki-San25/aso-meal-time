import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from db import MEALS, Reservation, ReservationHistory, SessionLocal, TimeSlot, User, init_db, now_jst
from security import hash_password, verify_password

BASE = Path(__file__).parent
IS_PROD = bool(os.environ.get("DATABASE_URL"))
ON_RENDER = bool(os.environ.get("RENDER"))  # Render が自動で設定する
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def bootstrap_admin() -> None:
    """ユーザーが1人もいなければ最初の管理者を作る"""
    with SessionLocal() as s:
        if s.scalar(select(func.count()).select_from(User)):
            return
        username = os.environ.get("ADMIN_USERNAME")
        password = os.environ.get("ADMIN_PASSWORD")
        if not (username and password):
            if IS_PROD:
                print("[warn] ユーザー未登録: ADMIN_USERNAME / ADMIN_PASSWORD を設定して再起動してください")
                return
            username, password = "admin", "admin"  # ローカル開発用
            print("[info] ローカル開発用の管理者 admin / admin を作成しました")
        s.add(User(username=username, display_name="管理者", password_hash=hash_password(password), is_admin=True))
        s.commit()


@asynccontextmanager
async def lifespan(_app):
    if ON_RENDER and not IS_PROD:
        # 消えるディスク上の SQLite や開発用 admin/admin で本番起動しないよう止める
        raise RuntimeError("DATABASE_URL が未設定です。Render で PostgreSQL を接続してください")
    init_db()
    bootstrap_admin()
    yield


app = FastAPI(title="阿蘇 喫食時間管理表", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET") or secrets.token_hex(32),
    session_cookie="amt_session",
    max_age=60 * 60 * 12,
    same_site="lax",
    https_only=IS_PROD or ON_RENDER,
)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


# ---------- 共通依存 ----------
def get_db():
    with SessionLocal() as s:
        yield s


def session_user(request: Request, db: Session) -> User | None:
    uid = request.session.get("uid")
    if uid is None:
        return None
    user = db.get(User, uid)
    return user if user and user.active else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = session_user(request, db)
    if not user:
        raise HTTPException(401, "ログインしてください")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "管理者のみ操作できます")
    return user


# ---------- 認証 ----------
class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username.strip()))
    if not user or not user.active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "IDまたはパスワードが違います")
    request.session.clear()
    request.session["uid"] = user.id
    return {"ok": True}


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", 303)


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.display_name, "username": user.username, "is_admin": user.is_admin}


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=8, max_length=128)


@app.post("/api/me/password")
def change_my_password(body: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current, user.password_hash):
        raise HTTPException(400, "現在のパスワードが違います")
    user.password_hash = hash_password(body.new)
    db.commit()
    return {"ok": True}


# ---------- 時間枠 ----------
def slot_labels(db: Session, meal: str) -> list[str]:
    return list(db.scalars(select(TimeSlot.label).where(TimeSlot.meal == meal).order_by(TimeSlot.sort)))


def check_meal(meal: str) -> str:
    if meal not in MEALS:
        raise HTTPException(404, "不明な区分です")
    return meal


@app.get("/api/slots/{meal}")
def get_slots(meal: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return slot_labels(db, check_meal(meal))


class SlotsIn(BaseModel):
    slots: list[str] = Field(max_length=48)

    @field_validator("slots")
    @classmethod
    def valid(cls, v):
        v = [s.strip() for s in v if s.strip()]
        for s in v:
            if not TIME_RE.match(s):
                raise ValueError(f"時刻は HH:MM 形式で入力してください: {s}")
        return sorted(set(v))


@app.put("/api/slots/{meal}")
def put_slots(meal: str, body: SlotsIn, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    check_meal(meal)
    for ts in db.scalars(select(TimeSlot).where(TimeSlot.meal == meal)):
        db.delete(ts)
    db.add_all(TimeSlot(meal=meal, label=l, sort=i) for i, l in enumerate(body.slots))
    db.commit()
    return body.slots


# ---------- 台帳 ----------
def norm_time(v: str | None) -> str | None:
    if v in (None, ""):
        return None
    if not TIME_RE.match(v):
        raise ValueError("時刻は HH:MM 形式で入力してください")
    return v


class ReservationIn(BaseModel):
    """編集用(日付・泊数は変更しない)"""
    model_config = ConfigDict(str_strip_whitespace=True)

    room: str = Field(min_length=1, max_length=32)
    guest_name: str = Field(default="", max_length=128)
    adults: int = Field(default=0, ge=0, le=99)
    children: int = Field(default=0, ge=0, le=99)
    infants: int = Field(default=0, ge=0, le=99)
    time_slot: str | None = None
    allergy: str = Field(default="", max_length=2000)
    note: str = Field(default="", max_length=2000)
    grouped: bool = False           # グループ登録する
    group_with: int | None = None   # 紐づける相手の予約ID

    _time = field_validator("time_slot")(norm_time)


class ReservationCreateIn(ReservationIn):
    """登録用: date は管理表で表示中の日付。泊数分の日付に1件ずつ登録する"""
    date: date
    nights: int = Field(default=1, ge=1, le=30)


class TimeSlotIn(BaseModel):
    time_slot: str | None = None

    _time = field_validator("time_slot")(norm_time)


TRACKED = ("date", "nights", "night_no", "time_slot", "room", "guest_name", "adults", "children", "infants",
           "allergy", "note", "group_id")
GROUP_FIELDS = {"grouped", "group_with"}


def iso(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def snapshot(r: Reservation) -> dict:
    return {f: (getattr(r, f).isoformat() if f == "date" else getattr(r, f)) for f in TRACKED}


def to_dict(r: Reservation, names: dict[int, str]) -> dict:
    return {
        "id": r.id, "meal": r.meal, **snapshot(r),
        "created_at": iso(r.created_at), "created_by": names.get(r.created_by, ""),
        "updated_at": iso(r.updated_at), "updated_by": names.get(r.updated_by, ""),
        "deleted": r.deleted_at is not None,
        "deleted_at": iso(r.deleted_at), "deleted_by": names.get(r.deleted_by, ""),
    }


def user_names(db: Session) -> dict[int, str]:
    return dict(db.execute(select(User.id, User.display_name)).all())


def get_reservation(db: Session, meal: str, rid: int, *, editable: bool = True) -> Reservation:
    r = db.get(Reservation, rid)
    if not r or r.meal != meal:
        raise HTTPException(404, "見つかりません")
    if editable and r.deleted_at is not None:
        raise HTTPException(400, "削除済みの予約は変更できません")
    return r


def record(db: Session, r: Reservation, user: User, action: str, changes: dict) -> None:
    """更新日時・更新者を記録し、履歴を1件追記する"""
    now = now_jst()
    r.updated_at, r.updated_by = now, user.id
    db.flush()
    db.add(ReservationHistory(reservation_id=r.id, action=action, changes=changes, changed_at=now,
                              changed_by=user.id))


def change(db: Session, r: Reservation, values: dict, user: User) -> None:
    """値を更新し、差分があれば履歴に残す(commit は呼び出し側)"""
    before = snapshot(r)
    for k, v in values.items():
        setattr(r, k, v)
    after = snapshot(r)
    diff = {f: [before[f], after[f]] for f in TRACKED if before[f] != after[f]}
    if diff:
        record(db, r, user, "update", diff)


# ---------- グループ ----------
def group_target(db: Session, meal: str, d: date, target_id: int | None, self_id: int | None) -> Reservation:
    t = db.get(Reservation, target_id) if target_id else None
    if not t or t.meal != meal or t.date != d or t.deleted_at is not None or t.id == self_id:
        raise HTTPException(400, "紐づける予約を選んでください")
    return t


def ensure_group(db: Session, t: Reservation, user: User) -> str:
    """相手がまだグループでなければ新しいグループにする"""
    if not t.group_id:
        change(db, t, {"group_id": uuid.uuid4().hex}, user)
    return t.group_id


def shrink_group(db: Session, group_id: str | None, user: User) -> None:
    """抜けた結果1件だけ残ったグループは解消する"""
    if not group_id:
        return
    db.flush()
    rest = list(db.scalars(select(Reservation).where(Reservation.group_id == group_id,
                                                     Reservation.deleted_at.is_(None))))
    if len(rest) == 1:
        change(db, rest[0], {"group_id": None}, user)


@app.get("/api/{meal}/reservations")
def list_reservations(meal: str, d: date, include_deleted: bool = False, _: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    check_meal(meal)
    q = select(Reservation).where(Reservation.meal == meal, Reservation.date == d)
    if not include_deleted:
        q = q.where(Reservation.deleted_at.is_(None))
    names = user_names(db)
    return [to_dict(r, names) for r in db.scalars(q.order_by(Reservation.room, Reservation.id))]


@app.post("/api/{meal}/reservations")
def create_reservation(meal: str, body: ReservationCreateIn, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    check_meal(meal)
    now = now_jst()
    values = body.model_dump(exclude={"date", "nights"} | GROUP_FIELDS)
    stay_id = uuid.uuid4().hex if body.nights > 1 else None
    target = group_target(db, meal, body.date, body.group_with, None) if body.grouped else None
    created = []
    for i in range(body.nights):
        d = body.date + timedelta(days=i)
        # 連泊時は、相手の同じ日の予約(相手も連泊なら)と紐づける
        mate = target if i == 0 or not target else (
            db.scalar(select(Reservation).where(Reservation.stay_id == target.stay_id, Reservation.date == d,
                                                Reservation.deleted_at.is_(None))) if target.stay_id else None)
        group_id = ensure_group(db, mate, user) if mate else None
        r = Reservation(meal=meal, date=d, nights=body.nights, night_no=i + 1,
                        stay_id=stay_id, group_id=group_id, **values,
                        created_at=now, created_by=user.id, updated_at=now, updated_by=user.id)
        db.add(r)
        db.flush()
        record(db, r, user, "create", {f: [None, v] for f, v in snapshot(r).items()})
        created.append(r)
    db.commit()
    names = user_names(db)
    return [to_dict(r, names) for r in created]


@app.put("/api/{meal}/reservations/{rid}")
def update_reservation(meal: str, rid: int, body: ReservationIn, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    r = get_reservation(db, check_meal(meal), rid)
    values = body.model_dump(exclude=GROUP_FIELDS)
    old_group = r.group_id
    if not body.grouped:
        values["group_id"] = None
    else:
        t = group_target(db, meal, r.date, body.group_with, r.id)
        if not (r.group_id and t.group_id == r.group_id):
            values["group_id"] = ensure_group(db, t, user)
    change(db, r, values, user)
    if old_group and old_group != r.group_id:
        shrink_group(db, old_group, user)
    db.commit()
    return to_dict(r, user_names(db))


@app.patch("/api/{meal}/reservations/{rid}/time")
def set_time(meal: str, rid: int, body: TimeSlotIn, user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    r = get_reservation(db, check_meal(meal), rid)
    change(db, r, {"time_slot": body.time_slot}, user)
    db.commit()
    return to_dict(r, user_names(db))


@app.delete("/api/{meal}/reservations/{rid}")
def delete_reservation(meal: str, rid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """論理削除: データは残し、削除日時・削除者を記録する"""
    r = get_reservation(db, check_meal(meal), rid)
    r.deleted_at, r.deleted_by = now_jst(), user.id
    record(db, r, user, "delete", {})
    db.commit()
    return to_dict(r, user_names(db))


@app.post("/api/{meal}/reservations/{rid}/restore")
def restore_reservation(meal: str, rid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = get_reservation(db, check_meal(meal), rid, editable=False)
    if r.deleted_at is None:
        raise HTTPException(400, "削除されていない予約です")
    r.deleted_at, r.deleted_by = None, None
    record(db, r, user, "restore", {})
    db.commit()
    return to_dict(r, user_names(db))


@app.get("/api/{meal}/reservations/{rid}/history")
def reservation_history(meal: str, rid: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    get_reservation(db, check_meal(meal), rid, editable=False)
    names = user_names(db)
    rows = db.scalars(select(ReservationHistory).where(ReservationHistory.reservation_id == rid)
                      .order_by(ReservationHistory.id.desc()))
    return [{"action": h.action, "changes": h.changes, "changed_at": iso(h.changed_at),
             "changed_by": names.get(h.changed_by, "")} for h in rows]


# ---------- ユーザー管理 ----------
def user_dict(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name,
            "is_admin": u.is_admin, "active": u.active}


class UserCreateIn(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_.-]{2,64}$")
    display_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    is_admin: bool = False


class UserUpdateIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_admin: bool | None = None
    active: bool | None = None


@app.get("/api/users")
def list_users(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [user_dict(u) for u in db.scalars(select(User).order_by(User.id))]


@app.post("/api/users")
def create_user(body: UserCreateIn, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(400, "そのログインIDは既に使われています")
    u = User(username=body.username, display_name=body.display_name.strip(),
             password_hash=hash_password(body.password), is_admin=body.is_admin)
    db.add(u)
    db.commit()
    return user_dict(u)


@app.put("/api/users/{uid}")
def update_user(uid: int, body: UserUpdateIn, me_: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "見つかりません")
    if u.id == me_.id and (body.is_admin is False or body.active is False):
        raise HTTPException(400, "自分自身の管理者権限の解除・無効化はできません")
    if body.display_name is not None:
        u.display_name = body.display_name.strip()
    if body.password is not None:
        u.password_hash = hash_password(body.password)
    if body.is_admin is not None:
        u.is_admin = body.is_admin
    if body.active is not None:
        u.active = body.active
    db.commit()
    return user_dict(u)


# ---------- ページ ----------
PAGES = {"dinner", "breakfast", "admin"}


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/")
def root():
    return RedirectResponse("/dinner")


@app.get("/login")
def login_page(request: Request, db: Session = Depends(get_db)):
    if session_user(request, db):
        return RedirectResponse("/dinner")
    return FileResponse(BASE / "pages" / "login.html")


@app.get("/{page}")
def page(page: str, request: Request, db: Session = Depends(get_db)):
    if page not in PAGES:
        return RedirectResponse("/dinner")
    user = session_user(request, db)
    if not user:
        return RedirectResponse("/login")
    if page == "admin" and not user.is_admin:
        return RedirectResponse("/dinner")
    return FileResponse(BASE / "pages" / f"{page}.html")
