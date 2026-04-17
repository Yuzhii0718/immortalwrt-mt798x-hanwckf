# SPDX-License-Identifier: GPL-2.0

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/kernel.mk

PKG_NAME:=airoha_an8811hb
PKG_RELEASE:=1.0.0

include $(INCLUDE_DIR)/package.mk

define KernelPackage/phy-air_an8811hb
  CATEGORY:=Airoha Properties
  SUBMENU:=Drivers
	TITLE:=Airoha AN8811HB PHY driver
	DEPENDS:=+kmod-libphy
	FILES:=$(PKG_BUILD_DIR)/mtk/air_an8811hb.ko
	AUTOLOAD:=$(call AutoLoad,20,air_an8811hb,1)
	KCONFIG:= \
	CONFIG_AIR_AN8811HB_PHY=m \
	CONFIG_AIR_AN8811HB_PHY_DEBUGFS=n
endef

define KernelPackage/phy-air_an8811hb/description
	Kernel module for Airoha AN8811HB PHY driver
endef

MAKE_OPTS_AIR8811:= \
	ARCH="$(LINUX_KARCH)" \
	CROSS_COMPILE="$(TARGET_CROSS)" \
	M="$(PKG_BUILD_DIR)/mtk/"

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
@( \
	if [ -f ./src/mtk/Makefile ]; then \
	$(MAKE) -C "$(LINUX_DIR)" \
		$(MAKE_OPTS_AIR8811) \
		modules; \
	else \
	echo "Failed to compile mtk/air_an8811hb"; \
	fi; \
)
endef

define KernelPackage/phy-air_an8811hb/install
	@echo copy firmware of air_an8811hb
	$(INSTALL_DIR) $(1)/lib/firmware/airoha/an8811hb
	$(CP) $(PKG_BUILD_DIR)/mtk/*.bin  $(1)/lib/firmware/airoha/an8811hb
endef

$(eval $(call KernelPackage,phy-air_an8811hb))
