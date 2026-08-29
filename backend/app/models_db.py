from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class NormalTemplate(Base):
    __tablename__ = "normal_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Groups every version of the same named template together. Multiple distinct templates
    # (different group_id) can now coexist for the same modality/body_region — only versions
    # within one group_id are exclusive (at most one active at a time).
    group_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # Stable identity shared by every version in a group, used to match templates across
    # machines during cross-device sync (local group_id/id are per-machine autoincrement
    # values and can collide between machines).
    sync_key: Mapped[str] = mapped_column(String, nullable=False)
    modality: Mapped[str] = mapped_column(String, nullable=False)
    body_region: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    findings_text: Mapped[str] = mapped_column(Text, nullable=False)
    conclusion_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    seq_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("group_id", "version", name="uq_template_version"),
        Index(
            "idx_active_template",
            "group_id",
            unique=True,
            sqlite_where=text("is_active = 1"),
        ),
    )


class PostProcessingRule(Base):
    __tablename__ = "postprocessing_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sync_key: Mapped[str] = mapped_column(String, nullable=False)
    find_text: Mapped[str] = mapped_column(String, nullable=False)
    replace_text: Mapped[str] = mapped_column(String, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RuleTombstone(Base):
    """Records a hard-deleted rule's sync_key so other machines delete their copy too
    instead of resurrecting it on the next sync import."""

    __tablename__ = "rule_tombstones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sync_key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReportDraft(Base):
    __tablename__ = "report_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    modality: Mapped[str] = mapped_column(String, nullable=False)
    body_region: Mapped[str] = mapped_column(String, nullable=False)
    patient_context: Mapped[str] = mapped_column(Text, nullable=False, default="")
    transcript_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    findings_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    conclusion_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    template_id: Mapped[int | None] = mapped_column(ForeignKey("normal_templates.id"), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
