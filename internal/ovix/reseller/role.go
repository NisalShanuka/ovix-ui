package reseller

import (
	"errors"

	"gorm.io/gorm"

	"ovix.store/ovix-ui/internal/database"
	"ovix.store/ovix-ui/internal/database/model"
)

// Role is a panel login's role.
type Role string

const (
	RoleOwner    Role = "owner"
	RoleReseller Role = "reseller"
)

// RoleOf returns the role of a users row: reseller when it has an ovix_admins
// row, otherwise owner (the original single panel login).
func RoleOf(userID int) (Role, error) {
	var admin model.OvixAdmin
	err := database.GetDB().Where("user_id = ?", userID).Take(&admin).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return RoleOwner, nil
	}
	if err != nil {
		return "", err
	}
	return RoleReseller, nil
}
