from fastapi import APIRouter, Depends
from sqlalchemy import select

from deps import DbSession, require_admin
from model import SiteSetting
from schemas import SettingItem

public = APIRouter(prefix="/api/settings", tags=["Website settings"])
admin = APIRouter(
    prefix="/api/admin/settings",
    tags=["Admin settings"],
    dependencies=[Depends(require_admin)],
)


@public.get("")
def public_settings(db: DbSession):
    settings = db.scalars(select(SiteSetting).order_by(SiteSetting.key)).all()
    return {item.key: item.value for item in settings}


@admin.get("")
def admin_settings(db: DbSession):
    settings = db.scalars(select(SiteSetting).order_by(SiteSetting.key)).all()
    return {item.key: item.value for item in settings}


@admin.put("")
def update_settings(items: list[SettingItem], db: DbSession):
    for item in items:
        setting = db.scalar(select(SiteSetting).where(SiteSetting.key == item.key))

        if setting is None:
            db.add(SiteSetting(key=item.key, value=item.value))
        else:
            setting.value = item.value

    db.commit()

    settings = db.scalars(select(SiteSetting).order_by(SiteSetting.key)).all()
    return {item.key: item.value for item in settings}
