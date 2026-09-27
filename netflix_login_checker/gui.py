from __future__ import annotations

import sys
from urllib.parse import quote, unquote, urlparse

try:
    from PySide6.QtCore import QThread, Signal
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtWidgets import (
        QApplication,
        QCheckBox,
        QComboBox,
        QFormLayout,
        QFrame,
        QGroupBox,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QMainWindow,
        QMessageBox,
        QPushButton,
        QScrollArea,
        QSpinBox,
        QTextEdit,
        QVBoxLayout,
        QWidget,
    )
except ImportError as exc:  # pragma: no cover - depends on local environment
    PYSIDE_IMPORT_ERROR: ImportError | None = exc
else:
    PYSIDE_IMPORT_ERROR = None

from .core import DEFAULT_PROFILES_DIR, DEFAULT_SESSION_URL, login_netflix
from .post_login_workflow import WorkflowResult, run_post_login_workflow


class ProfileWorker(QThread):
    log = Signal(str)
    status = Signal(str)
    profile_result = Signal(int, object)
    failed = Signal(str)
    finished_ok = Signal()

    def __init__(
        self,
        *,
        email: str,
        password: str,
        pin: str | None,
        count: int,
        headless: bool,
        slow_mo_ms: int,
        proxy_server: str | None,
    ) -> None:
        super().__init__()
        self.email = email
        self.password = password
        self.pin = pin
        self.count = count
        self.headless = headless
        self.slow_mo_ms = slow_mo_ms
        self.proxy_server = proxy_server

    def run(self) -> None:
        debug = lambda message: self.log.emit(message)
        try:
            self.log.emit("login_start")
            login_result = login_netflix(
                self.email,
                self.password,
                headless=self.headless,
                timeout_ms=30000,
                slow_mo_ms=self.slow_mo_ms,
                proxy_server=self.proxy_server,
                clear_cache=False,
                persistent_profile=True,
                profiles_dir=DEFAULT_PROFILES_DIR,
                debug=debug,
            )
            self.log.emit(f"login_result success={login_result.success} reason={login_result.reason}")
            if not login_result.success:
                self.failed.emit(f"Login ไม่สำเร็จ: {login_result.reason}")
                return

            for index in range(1, self.count + 1):
                self.status.emit(f"กำลังสร้างโปรไฟล์ {index}/{self.count}")
                result = run_post_login_workflow(
                    email=self.email,
                    account_password=self.password,
                    account_pin=self.pin,
                    profiles_dir=DEFAULT_PROFILES_DIR,
                    session_url=DEFAULT_SESSION_URL,
                    headless=self.headless,
                    timeout_ms=30000,
                    slow_mo_ms=self.slow_mo_ms,
                    proxy_server=self.proxy_server,
                    debug=debug,
                )
                self.profile_result.emit(index, result)
                if not result.success:
                    self.log.emit(f"profile_{index}_failed reason={result.reason}")
                    break

            self.finished_ok.emit()
        except Exception as exc:  # pragma: no cover - GUI fallback
            self.failed.emit(f"{type(exc).__name__}: {exc}")


class NetflixProfileCreatorWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.worker: ProfileWorker | None = None
        self.setWindowTitle("Netflix Profile Creator")
        self.resize(780, 720)

        self.email_input = QLineEdit()
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.Password)
        self.pin_input = QLineEdit()
        self.pin_input.setMaxLength(12)
        self.proxy_protocol_input = QComboBox()
        self.proxy_protocol_input.addItems(["SOCKS5", "HTTP", "HTTPS", "SOCKS4"])
        self.proxy_host_input = QLineEdit()
        self.proxy_host_input.setPlaceholderText("IP หรือ Host เช่น 164.90.185.232")
        self.proxy_host_input.editingFinished.connect(self._parse_proxy_text_from_host)
        self.proxy_port_input = QSpinBox()
        self.proxy_port_input.setRange(1, 65535)
        self.proxy_port_input.setValue(1080)
        self.proxy_user_input = QLineEdit()
        self.proxy_user_input.setPlaceholderText("optional")
        self.proxy_password_input = QLineEdit()
        self.proxy_password_input.setPlaceholderText("optional")
        self.proxy_password_input.setEchoMode(QLineEdit.Password)
        self.count_input = QSpinBox()
        self.count_input.setRange(1, 20)
        self.count_input.setValue(1)
        self.headless_input = QCheckBox("Headless")
        self.slow_mo_input = QSpinBox()
        self.slow_mo_input.setRange(0, 1000)
        self.slow_mo_input.setSingleStep(50)
        self.slow_mo_input.setValue(100)
        self.status_label = QLabel("พร้อมใช้งาน")
        self.start_button = QPushButton("เริ่มสร้างโปรไฟล์")
        self.start_button.clicked.connect(self.start)

        self.cards_layout = QVBoxLayout()
        self.cards_layout.addStretch(1)
        cards_container = QWidget()
        cards_container.setLayout(self.cards_layout)
        self.cards_scroll = QScrollArea()
        self.cards_scroll.setWidgetResizable(True)
        self.cards_scroll.setWidget(cards_container)

        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMinimumHeight(120)

        self._build_layout()

    def _build_layout(self) -> None:
        central = QWidget()
        root = QVBoxLayout(central)

        form_box = QGroupBox("ข้อมูลบัญชี")
        form = QFormLayout(form_box)
        form.addRow("Email แม่", self.email_input)
        form.addRow("Password", self.password_input)
        form.addRow("PIN บัญชี", self.pin_input)
        proxy_row = QWidget()
        proxy_layout = QHBoxLayout(proxy_row)
        proxy_layout.setContentsMargins(0, 0, 0, 0)
        proxy_layout.addWidget(self.proxy_protocol_input)
        proxy_layout.addWidget(self.proxy_host_input, stretch=1)
        proxy_layout.addWidget(self.proxy_port_input)
        form.addRow("Proxy", proxy_row)
        form.addRow("Proxy Username", self.proxy_user_input)
        form.addRow("Proxy Password", self.proxy_password_input)
        form.addRow("จำนวนโปรไฟล์", self.count_input)

        options = QWidget()
        options_layout = QHBoxLayout(options)
        options_layout.setContentsMargins(0, 0, 0, 0)
        options_layout.addWidget(self.headless_input)
        options_layout.addWidget(QLabel("Slow motion ms"))
        options_layout.addWidget(self.slow_mo_input)
        options_layout.addStretch(1)
        form.addRow("Options", options)
        root.addWidget(form_box)

        actions = QWidget()
        actions_layout = QHBoxLayout(actions)
        actions_layout.setContentsMargins(0, 0, 0, 0)
        actions_layout.addWidget(self.start_button)
        actions_layout.addWidget(self.status_label)
        actions_layout.addStretch(1)
        root.addWidget(actions)

        results_box = QGroupBox("โปรไฟล์ที่สร้าง")
        results_layout = QVBoxLayout(results_box)
        results_layout.addWidget(self.cards_scroll)
        root.addWidget(results_box, stretch=1)

        log_box = QGroupBox("Log")
        log_layout = QVBoxLayout(log_box)
        log_layout.addWidget(self.log_output)
        root.addWidget(log_box)

        self.setCentralWidget(central)

    def start(self) -> None:
        if self.worker and self.worker.isRunning():
            return

        email = self.email_input.text().strip()
        password = self.password_input.text().rstrip("\r\n")
        pin = self.pin_input.text().strip() or None
        proxy_server = self._build_proxy_server()
        count = self.count_input.value()

        if not email or not password:
            QMessageBox.critical(self, "ข้อมูลไม่ครบ", "กรุณาใส่ Email และ Password")
            return
        if proxy_server == "":
            QMessageBox.critical(self, "Proxy ไม่ถูกต้อง", "ถ้าใช้ proxy ต้องใส่ IP/Host และ Port ให้ครบ")
            return

        self._clear_cards()
        self._log("เริ่มทำงาน")
        self.status_label.setText("กำลังทำงาน...")
        self.start_button.setEnabled(False)

        self.worker = ProfileWorker(
            email=email,
            password=password,
            pin=pin,
            count=count,
            headless=self.headless_input.isChecked(),
            slow_mo_ms=self.slow_mo_input.value(),
            proxy_server=proxy_server,
        )
        self.worker.log.connect(self._log)
        self.worker.status.connect(self._set_status)
        self.worker.profile_result.connect(self._add_profile_card)
        self.worker.failed.connect(self._failed)
        self.worker.finished_ok.connect(self._finished)
        self.worker.start()

    def _set_status(self, message: str) -> None:
        self.status_label.setText(message)
        self._log(message)

    def _failed(self, message: str) -> None:
        self.status_label.setText("หยุดทำงาน")
        self._log(message)
        self.start_button.setEnabled(True)
        QMessageBox.critical(self, "เกิดข้อผิดพลาด", message)

    def _finished(self) -> None:
        self.status_label.setText("เสร็จแล้ว")
        self._log("done")
        self.start_button.setEnabled(True)

    def _add_profile_card(self, index: int, result: WorkflowResult) -> None:
        card = QFrame()
        card.setFrameShape(QFrame.StyledPanel)
        layout = QVBoxLayout(card)

        title = QLabel(f"โปรไฟล์ #{index} - {'สำเร็จ' if result.success else 'ไม่สำเร็จ'}")
        title.setStyleSheet("font-weight: 600;")
        layout.addWidget(title)

        fields = [
            ("Reason", result.reason),
            ("Profile Name", result.profile_name or "-"),
            ("Profile PIN", result.profile_pin or "-"),
            ("URL", result.url),
        ]
        for label, value in fields:
            row = QHBoxLayout()
            name = QLabel(label)
            name.setFixedWidth(100)
            row.addWidget(name)
            row.addWidget(QLabel(str(value)), stretch=1)
            layout.addLayout(row)

        copy_button = QPushButton("Copy")
        copy_button.clicked.connect(lambda _checked=False, r=result: self._copy_result(r))
        layout.addWidget(copy_button)

        self.cards_layout.insertWidget(self.cards_layout.count() - 1, card)

    def _copy_result(self, result: WorkflowResult) -> None:
        text = (
            f"profile_name={result.profile_name or ''}\n"
            f"profile_pin={result.profile_pin or ''}\n"
            f"success={result.success}\n"
            f"reason={result.reason}"
        )
        QGuiApplication.clipboard().setText(text)
        self.status_label.setText("copy แล้ว")

    def _build_proxy_server(self) -> str | None:
        self._parse_proxy_text_from_host()
        host = self.proxy_host_input.text().strip()
        if not host:
            return None

        protocol = self.proxy_protocol_input.currentText().strip().lower()
        port = self.proxy_port_input.value()
        username = self.proxy_user_input.text().strip()
        password = self.proxy_password_input.text()
        if not protocol or not port:
            return ""

        credentials = ""
        if username:
            credentials = quote(username, safe="")
            if password:
                credentials += f":{quote(password, safe='')}"
            credentials += "@"
        return f"{protocol}://{credentials}{host}:{port}"

    def _parse_proxy_text_from_host(self) -> None:
        text = self.proxy_host_input.text().strip()
        if "://" not in text:
            return

        parsed = urlparse(text)
        if not parsed.scheme or not parsed.hostname:
            return

        protocol = parsed.scheme.upper()
        protocol_index = self.proxy_protocol_input.findText(protocol)
        if protocol_index >= 0:
            self.proxy_protocol_input.setCurrentIndex(protocol_index)

        self.proxy_host_input.blockSignals(True)
        self.proxy_host_input.setText(parsed.hostname)
        self.proxy_host_input.blockSignals(False)

        if parsed.port:
            self.proxy_port_input.setValue(parsed.port)
        if parsed.username:
            self.proxy_user_input.setText(unquote(parsed.username))
        if parsed.password:
            self.proxy_password_input.setText(unquote(parsed.password))

    def _clear_cards(self) -> None:
        while self.cards_layout.count() > 1:
            item = self.cards_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

    def _log(self, message: str) -> None:
        self.log_output.append(message)


def main() -> None:
    if PYSIDE_IMPORT_ERROR:
        raise SystemExit(
            "PySide6 is not installed. Run: pip install -r requirements-netflix-login.txt"
        )
    app = QApplication(sys.argv)
    window = NetflixProfileCreatorWindow()
    window.show()
    raise SystemExit(app.exec())


if __name__ == "__main__":
    main()
